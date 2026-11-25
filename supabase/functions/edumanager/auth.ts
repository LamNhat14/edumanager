export type Rpc = (name: string, args: Record<string, unknown>) => Promise<any>;
export interface Passwords {
  hash(value: string): Promise<string>;
  compare(value: string, hash: string): Promise<boolean>;
}
export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function validatePassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    new TextEncoder().encode(value).length > 72
  )
    throw new AuthError(
      422,
      "INVALID_PASSWORD",
      "Mật khẩu phải có ít nhất 12 ký tự và tối đa 72 byte UTF-8.",
    );
  return value;
}
export async function fingerprint(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function newToken() {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export function createAuth(rpc: Rpc, passwords: Passwords, secret: string) {
  if (secret.length < 32)
    throw new Error("APP_SESSION_SECRET must be at least 32 characters");
  // Work factor equals real users; generated once per instance with an unknown random password.
  let dummy: Promise<string> | undefined;
  return async (request: Request, path: string, requestId: string) => {
    let body: Record<string, any> = {};
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      if (!request.headers.get("content-type")?.includes("application/json"))
        throw new AuthError(415, "CONTENT_TYPE", "Yêu cầu JSON.");
      const reader = request.body?.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > (path === '/academic' ? 524288 : 16384)) {
            await reader.cancel();
            throw new AuthError(413, "TOO_LARGE", "Nội dung quá lớn.");
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
        if (!body || Array.isArray(body) || typeof body !== "object") throw 0;
      } catch {
        throw new AuthError(422, "INVALID_INPUT", "JSON không hợp lệ.");
      }
    }
    if (path === "/auth/login" && request.method === "POST") {
      const username =
        typeof body.username === "string"
          ? body.username.trim().toLowerCase()
          : "";
      if (
        !/^[a-z0-9_.-]{3,64}$/.test(username) ||
        typeof body.password !== "string" ||
        new TextEncoder().encode(body.password).length > 72
      )
        throw new AuthError(
          401,
          "UNAUTHENTICATED",
          "Tên đăng nhập hoặc mật khẩu không đúng.",
        );
      // Global budget until the deployment's trusted client-IP header is verified.
      // Never let a client-spoofable forwarded header bypass throttling.
      const ip = "global-login-budget";
      const begin = await rpc("login_begin", {
        p_username: username,
        p_account: await fingerprint("account:" + username, secret),
        p_ip: await fingerprint("ip:" + ip, secret),
      });
      if (begin.limited)
        throw new AuthError(
          429,
          "RATE_LIMIT",
          "Quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút.",
        );
      const hash =
        begin.password_hash || (await (dummy ??= passwords.hash(newToken())));
      if (!(await passwords.compare(body.password, hash)) || !begin.user_id)
        throw new AuthError(
          401,
          "UNAUTHENTICATED",
          "Tên đăng nhập hoặc mật khẩu không đúng.",
        );
      const token = newToken();
      const result = await rpc("login_finish", {
        p_attempt: begin.attempt,
        p_uid: begin.user_id,
        p_expected_hash: hash,
        p_token_hash: await fingerprint(token, secret),
        p_request: requestId,
      });
      return { ...result, token };
    }
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token)
      throw new AuthError(401, "UNAUTHENTICATED", "Vui lòng đăng nhập.");
    const tokenHash = await fingerprint(token, secret);
    const command = (action: string, data: Record<string, unknown> = {}) =>
      rpc("auth_command", {
        p_hash: tokenHash,
        p_action: action,
        p_data: data,
        p_request: requestId,
      });
    const user = await command("me"); // Validate before any hash work or admin processing.
    if (path === "/auth/me" && request.method === "GET") return user;
    if (path === "/auth/logout" && request.method === "POST")
      return command("logout");
    if (path === "/auth/change-password" && request.method === "POST") {
      validatePassword(body.password);
      if (
        typeof body.current_password !== "string" ||
        new TextEncoder().encode(body.current_password).length > 72
      )
        throw new AuthError(422, "INVALID_INPUT", "Nhập mật khẩu hiện tại.");
      const old = await command("password_material");
      if (!(await passwords.compare(body.current_password, old.password_hash)))
        throw new AuthError(
          401,
          "UNAUTHENTICATED",
          "Mật khẩu hiện tại không đúng.",
        );
      if (body.password === body.current_password)
        throw new AuthError(
          422,
          "INVALID_PASSWORD",
          "Mật khẩu mới phải khác mật khẩu hiện tại.",
        );
      return command("change_password", {
        expected_hash: old.password_hash,
        password_hash: await passwords.hash(body.password),
      });
    }
    if (user.must_change_password)
      throw new AuthError(
        403,
        "PASSWORD_CHANGE_REQUIRED",
        "Vui lòng đổi mật khẩu trước khi tiếp tục.",
      );
    if (["/academic", "/operations"].includes(path) && request.method === "POST") {
      if (typeof body.action !== "string" || !body.data || typeof body.data !== "object" || Array.isArray(body.data))
        throw new AuthError(422, "INVALID_INPUT", "Thao tác không hợp lệ.");
      return rpc(path.slice(1), {p_hash: tokenHash,p_action: body.action,p_data: body.data,p_request: requestId});
    }
    const permission = path === "/audit-logs" ? "audit.view" : "users.manage";
    if (!user.permissions.includes(permission))
      throw new AuthError(
        403,
        "FORBIDDEN",
        "Bạn không có quyền thực hiện thao tác này.",
      );
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      throw new AuthError(422, "INVALID_INPUT", "Trang không hợp lệ.");
    if (path === "/admin/users" && request.method === "GET")
      return command("list_users", {
        q: url.searchParams.get("q") || "",
        offset,
      });
    if (path === "/admin/roles" && request.method === "GET")
      return command("roles");
    if (path === "/audit-logs" && request.method === "GET")
      return command("audit", { offset });
    function roles() {
      if (
        !Array.isArray(body.roles) ||
        !body.roles.length ||
        body.roles.some(
          (r: unknown) =>
            typeof r !== "string" ||
            !["admin", "manager", "accountant", "academic", "teacher"].includes(
              r,
            ),
        )
      )
        throw new AuthError(422, "INVALID_ROLE", "Chọn vai trò hợp lệ.");
      return [...new Set(body.roles)];
    }
    function name() {
      if (
        typeof body.display_name !== "string" ||
        !body.display_name.trim() ||
        body.display_name.trim().length > 120
      )
        throw new AuthError(422, "INVALID_INPUT", "Tên hiển thị không hợp lệ.");
      return body.display_name.trim();
    }
    if (path === "/admin/users" && request.method === "POST") {
      const username = String(body.username || "")
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9_.-]{3,64}$/.test(username))
        throw new AuthError(
          422,
          "INVALID_INPUT",
          "Tên đăng nhập gồm 3–64 chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.",
        );
      const display_name = name(),
        selectedRoles = roles();
      return command("create_user", {
        username,
        display_name,
        roles: selectedRoles,
        password_hash: await passwords.hash(validatePassword(body.password)),
      });
    }
    const match = path.match(
      /^\/admin\/users\/([a-f0-9-]{36})(?:\/(roles|reset-password|revoke-sessions))?$/,
    );
    if (match) {
      const id = match[1];
      const action = match[2];
      if (
        typeof body.reason !== "string" ||
        !body.reason.trim() ||
        body.reason.length > 500
      )
        throw new AuthError(
          422,
          "REASON_REQUIRED",
          "Cần lý do thao tác (tối đa 500 ký tự).",
        );
      const data = { id, version: body.version, reason: body.reason.trim() };
      if (!action && request.method === "PATCH")
        return command("update_user", {
          ...data,
          display_name: name(),
          status: body.status,
        });
      if (action === "roles" && request.method === "PUT")
        return command("set_roles", { ...data, roles: roles() });
      if (action === "reset-password" && request.method === "POST")
        return command("reset_password", {
          ...data,
          password_hash: await passwords.hash(validatePassword(body.password)),
        });
      if (action === "revoke-sessions" && request.method === "POST")
        return command("revoke_sessions", data);
    }
    throw new AuthError(404, "NOT_FOUND", "Không tìm thấy endpoint.");
  };
}
