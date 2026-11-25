// Generated TypeScript for Supabase Dashboard; edit source modules then regenerate.
// Source: edumanager/auth.ts
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

// Source: edumanager/rpc.ts

export const businessErrors: Record<string,string> = {
 REASON_REQUIRED:'Cần nhập lý do thao tác.',INVALID_FIELD:'Trường dữ liệu không được phép.',
 IMMUTABLE_ENROLLMENT:'Không sửa danh tính đăng ký. Hãy dùng chuyển lớp.',ENROLLMENT_OVERLAP:'Đăng ký trùng thời gian với môn đã học.',
 OUTSIDE_CLASS_DATES:'Ngày nằm ngoài thời gian lớp hoặc phân công.',IMPORT_LIMIT:'Mỗi lần nhập từ 1 đến 500 học viên.',DUPLICATE_STUDENT:'Trùng học viên theo họ tên, ngày sinh và khối. Toàn bộ lượt nhập đã hủy.',
 IMMUTABLE_LEDGER:'Chứng từ đã ghi sổ không được sửa hoặc xóa.',SCHEDULE_CONFLICT:'Trùng lịch giáo viên, phòng hoặc lớp–môn. Chưa lưu buổi nào.',
 TEACHER_NOT_LINKED:'Tài khoản chưa được Admin liên kết với hồ sơ giáo viên.',IDEMPOTENCY_REQUIRED:'Thiếu mã chống ghi trùng.',IDEMPOTENCY_CONFLICT:'Mã thao tác đã dùng cho dữ liệu khác. Hãy mở lại biểu mẫu.',
 ASSIGNMENT_OVERLAP:'Phân công trùng khoảng thời gian lớp–môn.',INVALID_STATE:'Trạng thái hiện tại không cho phép thao tác này.',INVALID_COMBO:'Combo cần đúng ba môn khác nhau, còn hiệu lực và đủ đăng ký.',
 OVERRIDE_APPROVAL_REQUIRED:'Chỉ Quản lý hoặc Admin được quyết định học phí khác giá niêm yết, kèm lý do.',POLICY_REQUIRED:'Thiếu học phí hoặc phân công giáo viên có hiệu lực.',
 MIDMONTH_DECISION_REQUIRED:'Đăng ký giữa tháng cần Quản lý quyết định số tiền và nhập lý do.',NO_ENROLLMENTS:'Không có đăng ký đủ điều kiện trong tháng.',
 REFUND_EXCEEDS_PAYMENT:'Tổng yêu cầu hoàn vượt số tiền phiếu thu.',PERIOD_NOT_ENDED:'Chỉ chốt kỳ lương đã kết thúc.',UNREVIEWED_SESSIONS:'Còn buổi dạy chưa duyệt hoặc hủy trong kỳ.',
 PERIOD_CLOSED:'Kỳ lương đã chốt. Chọn kỳ mở tiếp theo.',OVERPAYMENT:'Số chi vượt số lương còn phải trả.',
 ASSIGNMENT_IN_USE:'Còn lịch hoặc hóa đơn sau ngày kết thúc phân công. Hủy lịch tương lai hoặc chọn ngày sau chứng từ đã phát hành.',
};
export function restRpc(url: string, key: string) {
  return async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Content-Profile": "app_api",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (!response.ok) {
      const message = String(body.message || "");
      if (businessErrors[message]) throw new AuthError(422,message,businessErrors[message]);
      if (['23502','23503','23514','22P02','22007','22008'].includes(body.code))
        throw new AuthError(422,'INVALID_INPUT','Dữ liệu thiếu, sai định dạng hoặc tham chiếu không hợp lệ. Kiểm tra các trường bắt buộc.');
      const code =
        [
          "UNAUTHENTICATED",
          "FORBIDDEN",
          "PASSWORD_CHANGE_REQUIRED",
          "NOT_FOUND",
          "CONFLICT",
          "LAST_ADMIN",
          "INVALID_INPUT",
          "INVALID_ROLE",
          "BOOTSTRAP_CLOSED",
        ].find((c) => message === c) ||
        (body.code === "23505" ? "DUPLICATE" : "BACKEND_ERROR");
      const messages: Record<string, string> = {
        UNAUTHENTICATED:
          "Phiên không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
        FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
        PASSWORD_CHANGE_REQUIRED: "Cần đổi mật khẩu trước khi tiếp tục.",
        LAST_ADMIN: "Không thể khóa hoặc gỡ vai trò Admin cuối cùng.",
        CONFLICT: "Dữ liệu đã thay đổi. Hãy tải lại.",
        DUPLICATE: "Bản ghi đã tồn tại (mã, kỳ hóa đơn hoặc kỳ lương bị trùng).",
        BOOTSTRAP_CLOSED: "Đã có tài khoản. Khởi tạo đã đóng.",
        INVALID_ROLE: "Vai trò không hợp lệ.",
        INVALID_INPUT: "Dữ liệu không hợp lệ.",
        NOT_FOUND: "Không tìm thấy bản ghi.",
        BACKEND_ERROR: "Không thể xử lý yêu cầu backend.",
      };
      throw new AuthError(
        code === "UNAUTHENTICATED"
          ? 401
          : ["FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes(code)
            ? 403
            : [
                  "CONFLICT",
                  "LAST_ADMIN",
                  "DUPLICATE",
                  "BOOTSTRAP_CLOSED",
                ].includes(code)
              ? 409
              : code === "NOT_FOUND"
                ? 404
                : code.startsWith("INVALID")
                  ? 422
                  : 503,
        code,
        messages[code],
      );
    }
    return body;
  };
}

// Source: bootstrap-admin/handler.ts

export function createBootstrapHandler(
  config: { enabled: boolean; key: string },
  rpc: Rpc,
  hash: (p: string) => Promise<string>,
) {
  return async (request: Request) => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers });
    if (!config.enabled || !config.key || request.method !== "POST")
      return reply(404, { error: "NOT_FOUND" });
    const supplied =
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    if (
      (await fingerprint(supplied, config.key)) !==
      (await fingerprint(config.key, config.key))
    )
      return reply(403, { error: "FORBIDDEN" });
    try {
      const text = await request.text();
      if (text.length > 4096) return reply(413, { error: "TOO_LARGE" });
      const body = JSON.parse(text);
      const password = validatePassword(body.password);
      if (
        typeof body.username !== "string" ||
        !/^[a-z0-9_.-]{3,64}$/.test(body.username) ||
        typeof body.display_name !== "string" ||
        !body.display_name.trim() ||
        body.display_name.length > 120
      )
        return reply(422, { error: "INVALID_INPUT" });
      const user = await rpc("bootstrap_admin", {
        p_username: body.username,
        p_name: body.display_name.trim(),
        p_hash: await hash(password),
      });
      return reply(201, { data: user });
    } catch (e) {
      return reply(e instanceof AuthError ? e.status : 422, {
        error: e instanceof AuthError ? e.code : "INVALID_INPUT",
      });
    }
  };
}

// Source: bootstrap-admin/index.ts
import { hash } from "npm:bcryptjs@3.0.3";


const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
Deno.serve(
  createBootstrapHandler(
    { enabled: Deno.env.get("BOOTSTRAP_ENABLED") === "true", key },
    restRpc(Deno.env.get("SUPABASE_URL") || "", key),
    (p) => hash(p, 12),
  ),
);
