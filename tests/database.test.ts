import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
const db = new PGlite();
const actor = "11111111-1111-4111-8111-111111111111";
beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls;",
  );
  for (const name of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.query(
    "insert into app_private.app_users(id,username,display_name,password_hash) values($1,'test_operator','Test operator','TEST_ONLY_NOT_A_PASSWORD')",
    [actor],
  );
}, 30000);
afterAll(async () => {
  await db.close();
});
it("applies both migrations on a fresh PostgreSQL engine", async () => {
  expect(
    (await db.query("select * from app_private.schema_versions")).rows,
  ).toHaveLength((await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).length);
});
it("contains no sample students, subjects, or teachers", async () => {
  for (const table of ["students", "subjects", "teachers"])
    expect(
      (await db.query(`select * from app_private.${table}`)).rows,
    ).toHaveLength(0);
});
it("RLS is enabled for every private table", async () => {
  const result = await db.query(
    "select relname from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='app_private' and c.relkind='r' and not c.relrowsecurity",
  );
  expect(result.rows).toHaveLength(0);
});
it("anon and authenticated cannot read or execute private functions", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await expect(
        db.query("select * from app_private.students"),
      ).rejects.toThrow();
      await expect(
        db.query("select app_api.schema_status()"),
      ).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  }
});
it("service role can inspect schema version but cannot directly write students", async () => {
  await db.exec("set role service_role");
  try {
    expect(
      (await db.query("select app_api.schema_status()")).rows,
    ).toHaveLength(1);
    await expect(
      db.query("select * from app_private.students"),
    ).rejects.toThrow();
  } finally {
    await db.exec("reset role");
  }
});
it("requires audit context for changes", async () => {
  await expect(
    db.query(
      "insert into app_private.students(full_name,grade,admission_date) values('Test',7,current_date)",
    ),
  ).rejects.toThrow("Audit context required");
});
it("writes audit atomically, preserves shared phones, and increments version", async () => {
  await db.transaction(async (tx) => {
    await tx.query(
      "select set_config('app.actor_id',$1,true),set_config('app.request_id',$2,true)",
      [actor, actor],
    );
    const result = await tx.query<{ id: string }>(
      "insert into app_private.students(full_name,grade,admission_date,phone) values('Test A',7,current_date,'shared'),('Test B',8,current_date,'shared') returning id",
    );
    const id = result.rows[0].id;
    await tx.query(
      "update app_private.students set full_name='Updated' where id=$1",
      [id],
    );
    expect(
      (
        await tx.query<{ version: number }>(
          "select version from app_private.students where id=$1",
          [id],
        )
      ).rows[0].version,
    ).toBe(2);
    expect(
      (
        await tx.query(
          "select * from app_private.audit_logs where entity_id=$1",
          [id],
        )
      ).rows,
    ).toHaveLength(2);
  });
});
it("rejects invalid grades and duplicate usernames", async () => {
  await expect(
    db.query(
      "insert into app_private.students(full_name,grade,admission_date) values('Test',13,current_date)",
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      "insert into app_private.app_users(username,display_name,password_hash) values('test_operator','Dup','TEST_ONLY')",
    ),
  ).rejects.toThrow();
});
it("prevents audit update/delete/truncate", async () => {
  for (const sql of [
    "update app_private.audit_logs set reason='changed'",
    "delete from app_private.audit_logs",
    "truncate app_private.audit_logs",
  ])
    await expect(db.exec(sql)).rejects.toThrow("append-only");
});
