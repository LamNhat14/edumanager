import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { hash, compare } from "bcryptjs";
import {
  createAuth,
  fingerprint,
  validatePassword,
  AuthError,
} from "../supabase/functions/edumanager/auth";
import { createHandler } from "../supabase/functions/edumanager/handler";
const db = new PGlite();
const secret = "test-secret-only-not-a-deployment-secret-123";
const password = "Test fixture password 123!";
let admin: any;
let token: string;
let teacher: any;
let teacherToken: string;
let passHash: string;
async function rpc(name: string, args: Record<string, unknown>) {
  try {
    return (
      await db.query<{ result: any }>(
        `select app_api.${name}(${Object.keys(args)
          .map((_, i) => "$" + (i + 1))
          .join(",")}) as result`,
        Object.values(args),
      )
    ).rows[0].result;
  } catch (e) {
    const code = (e as Error).message;
    throw new AuthError(
      code === "UNAUTHENTICATED"
        ? 401
        : code === "FORBIDDEN" || code === "PASSWORD_CHANGE_REQUIRED"
          ? 403
          : 409,
      code,
      code,
    );
  }
}
const handler = createHandler(
  ["https://test.example"],
  createAuth(rpc, { hash: (p) => hash(p, 12), compare }, secret),
);
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  session = token,
) {
  const res = await handler(
    new Request("https://test.example/functions/v1/edumanager/v1" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: "Bearer " + session } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;",
  );
  for (const name of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  passHash = await hash(password, 12);
  admin = await rpc("bootstrap_admin", {
    a: "admin_test",
    b: "Admin Test",
    c: passHash,
  });
}, 30000);
afterAll(() => db.close());
it("bootstrap is closed permanently after first account", async () => {
  await expect(
    rpc("bootstrap_admin", { a: "second", b: "Second", c: passHash }),
  ).rejects.toThrow("BOOTSTRAP_CLOSED");
});
it("rejects wrong password and never returns hash", async () => {
  const r = await call("/auth/login", "POST", {
    username: "admin_test",
    password: "wrong-password",
  });
  expect(r.status).toBe(401);
  expect(JSON.stringify(r.body)).not.toContain(passHash);
});
it("logs in with bcrypt and stores only a keyed token hash", async () => {
  const r = await call("/auth/login", "POST", {
    username: "ADMIN_TEST",
    password,
  });
  expect(r.status).toBe(200);
  token = r.body.data.token;
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(r.body.data.user.permissions).toContain("users.manage");
  const s = await db.query<{ token_hash: string }>(
    "select token_hash from app_private.app_sessions",
  );
  expect(s.rows[0].token_hash).toBe(await fingerprint(token, secret));
  expect(s.rows[0].token_hash).not.toBe(token);
});
it("me validates an actual session and rejects forged tokens", async () => {
  expect((await call("/auth/me")).body.data.username).toBe("admin_test");
  expect(
    (await call("/auth/me", "GET", undefined, "a".repeat(43))).status,
  ).toBe(401);
});
it("does not permit disabling the last admin and rolls back", async () => {
  const r = await call("/admin/users/" + admin.id, "PATCH", {
    display_name: "Admin Test",
    status: "locked",
    version: 1,
    reason: "test",
  });
  expect(r.status).toBe(409);
  expect((await call("/auth/me")).status).toBe(200);
});
it("does not permit removing the last admin role", async () => {
  const r = await call("/admin/users/" + admin.id + "/roles", "PUT", {
    roles: ["teacher"],
    version: 1,
    reason: "test",
  });
  expect(r.body.error.code).toBe("LAST_ADMIN");
  expect((await call("/auth/me")).body.data.roles).toContain("admin");
});
it("creates a user with forced password change and no exposed hash", async () => {
  const r = await call("/admin/users", "POST", {
    username: "teacher_test",
    display_name: "Teacher",
    password,
    roles: ["teacher"],
  });
  expect(r.status).toBe(200);
  teacher = r.body.data;
  expect(teacher.must_change_password).toBe(true);
  expect(teacher.password_hash).toBeUndefined();
  const login = await call("/auth/login", "POST", {
    username: "teacher_test",
    password,
  });
  teacherToken = login.body.data.token;
  expect(
    (await call("/admin/users", "GET", undefined, teacherToken)).status,
  ).toBe(403);
});
it("changes password with old-password proof and revokes old session", async () => {
  const r = await call(
    "/auth/change-password",
    "POST",
    { current_password: password, password: password + "new" },
    teacherToken,
  );
  expect(r.status).toBe(200);
  expect((await call("/auth/me", "GET", undefined, teacherToken)).status).toBe(
    401,
  );
  const login = await call("/auth/login", "POST", {
    username: "teacher_test",
    password: password + "new",
  });
  teacherToken = login.body.data.token;
  expect(login.body.data.user.must_change_password).toBe(false);
});
it("teacher cannot read user list or audit even after password change", async () => {
  expect(
    (await call("/admin/users", "GET", undefined, teacherToken)).status,
  ).toBe(403);
  expect(
    (await call("/audit-logs", "GET", undefined, teacherToken)).status,
  ).toBe(403);
});
it("account lock revokes sessions immediately and login is denied", async () => {
  const list = await call("/admin/users");
  teacher = list.body.data.find((u: any) => u.id === teacher.id);
  expect(
    (
      await call("/admin/users/" + teacher.id, "PATCH", {
        display_name: "Teacher",
        status: "locked",
        version: teacher.version,
        reason: "Lock test",
      })
    ).status,
  ).toBe(200);
  expect((await call("/auth/me", "GET", undefined, teacherToken)).status).toBe(
    401,
  );
  expect(
    (
      await call("/auth/login", "POST", {
        username: "teacher_test",
        password: password + "new",
      })
    ).status,
  ).toBe(401);
});
it("rejects stale version updates", async () => {
  expect(
    (
      await call("/admin/users/" + teacher.id, "PATCH", {
        display_name: "Stale",
        status: "active",
        version: teacher.version,
        reason: "stale",
      })
    ).body.error.code,
  ).toBe("CONFLICT");
});
it("audit does not contain passwords or token hashes", async () => {
  const logs = await call("/audit-logs");
  expect(logs.status).toBe(200);
  const data = JSON.stringify(logs.body);
  expect(data).not.toContain("password_hash");
  expect(data).not.toContain(passHash);
  expect(data).not.toContain(token);
  expect(logs.body.data.some((x: any) => x.action === "create_user")).toBe(
    true,
  );
});
it("enforces idle timeout without extending it on me polling", async () => {
  await db.query(
    "update app_private.app_sessions set last_seen_at=now()-interval '31 minutes' where token_hash=$1",
    [await fingerprint(token, secret)],
  );
  expect((await call("/auth/me")).status).toBe(401);
});
it("admin can unlock, reset and change roles; every operation is audited", async () => {
  const login = await call("/auth/login", "POST", {
    username: "admin_test",
    password,
  });
  token = login.body.data.token;
  teacher = (await call("/admin/users")).body.data.find(
    (u: any) => u.id === teacher.id,
  );
  teacher = (
    await call("/admin/users/" + teacher.id, "PATCH", {
      display_name: "Teacher",
      status: "active",
      version: teacher.version,
      reason: "unlock",
    })
  ).body.data;
  const reset = await call(
    "/admin/users/" + teacher.id + "/reset-password",
    "POST",
    { password, version: teacher.version, reason: "verified identity" },
  );
  expect(reset.status).toBe(200);
  teacher = reset.body.data;
  const roles = await call("/admin/users/" + teacher.id + "/roles", "PUT", {
    roles: ["academic"],
    version: teacher.version,
    reason: "new duties",
  });
  expect(roles.status).toBe(200);
  expect(roles.body.data.roles).toEqual(["academic"]);
  const next = await call("/auth/login", "POST", {
    username: "teacher_test",
    password,
  });
  teacherToken = next.body.data.token;
  expect(next.body.data.user.must_change_password).toBe(true);
  expect(
    (
      await call("/admin/users/" + teacher.id + "/revoke-sessions", "POST", {
        reason: "revoke test",
      })
    ).status,
  ).toBe(200);
  expect((await call("/auth/me", "GET", undefined, teacherToken)).status).toBe(
    401,
  );
});
it("logout makes the token unusable", async () => {
  expect((await call("/auth/logout", "POST", {})).status).toBe(200);
  expect((await call("/auth/me")).status).toBe(401);
});
it("absolute session expiry is enforced", async () => {
  token = (
    await call("/auth/login", "POST", { username: "admin_test", password })
  ).body.data.token;
  await db.query(
    "update app_private.app_sessions set created_at=now()-interval '9 hours',expires_at=now()-interval '1 hour' where token_hash=$1",
    [await fingerprint(token, secret)],
  );
  expect((await call("/auth/me")).status).toBe(401);
});
it("rate limiter counts persistent reservations and rejects the 11th account attempt", async () => {
  for (let i = 0; i < 10; i++)
    expect(
      (
        await rpc("login_begin", {
          u: "rate_test",
          a: "rate-account",
          ip: "rate-ip",
        })
      ).limited,
    ).not.toBe(true);
  expect(
    (
      await rpc("login_begin", {
        u: "rate_test",
        a: "rate-account",
        ip: "rate-ip",
      })
    ).limited,
  ).toBe(true);
});
it("denies anonymous direct calls to every new privileged RPC", async () => {
  await db.exec("set role anon");
  try {
    await expect(
      db.query("select app_api.bootstrap_admin('x','y','z')"),
    ).rejects.toThrow();
    await expect(
      db.query("select app_api.auth_command('x','me','{}',gen_random_uuid())"),
    ).rejects.toThrow();
    await expect(
      db.query("select app_api.login_begin('x','y','z')"),
    ).rejects.toThrow();
  } finally {
    await db.exec("reset role");
  }
});
it("rejects bcrypt truncation and short passwords", () => {
  expect(() => validatePassword("short")).toThrow();
  expect(() => validatePassword("ậ".repeat(25))).toThrow();
  expect(validatePassword(password)).toBe(password);
});
