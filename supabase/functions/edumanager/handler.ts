import { AuthError } from "./auth.ts";
export function createHandler(
  allowedOrigins: string[],
  auth?: (
    request: Request,
    path: string,
    requestId: string,
  ) => Promise<unknown>,
) {
  const origins = new Set(allowedOrigins.filter(Boolean));
  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const origin = request.headers.get("Origin");
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
      "X-Request-Id": requestId,
    });
    const reply = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers });
    const error = (status: number, code: string, message: string) =>
      reply(status, { error: { code, message, requestId } });
    if (origin && !origins.has(origin))
      return error(403, "ORIGIN_DENIED", "Nguồn yêu cầu không được cho phép.");
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, PUT, OPTIONS",
    );
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, idempotency-key",
    );
    headers.set("Access-Control-Expose-Headers", "X-Request-Id");
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    // Hosted gateway and local direct function paths both start at /edumanager/v1.
    const pathname = new URL(request.url).pathname;
    const prefix = pathname.startsWith("/functions/v1/")
      ? "/functions/v1/edumanager/v1"
      : "/edumanager/v1";
    if (!pathname.startsWith(prefix + "/"))
      return error(404, "NOT_FOUND", "Không tìm thấy endpoint.");
    const path = pathname.slice(prefix.length);
    if (path === "/health") {
      if (request.method !== "GET")
        return error(405, "METHOD_NOT_ALLOWED", "Chỉ hỗ trợ GET.");
      return reply(200, {
        data: {
          status: "ok",
          stage: 9,
          version: "0.9.0",
          database: "not_checked",
          authentication: auth ? "configured" : "not_configured",
        },
        meta: { requestId },
      });
    }
    if (auth) {
      try {
        return reply(200, {
          data: await auth(request, path, requestId),
          meta: { requestId },
        });
      } catch (e) {
        if (e instanceof AuthError) return error(e.status, e.code, e.message);
        return error(
          503,
          "BACKEND_ERROR",
          "Không thể xử lý yêu cầu. Vui lòng thử lại.",
        );
      }
    }
    if (
      !request.headers.get("Authorization")?.match(/^Bearer [A-Za-z0-9_-]{43}$/)
    )
      return error(
        401,
        "UNAUTHENTICATED",
        "Yêu cầu phiên đăng nhập nội bộ hợp lệ.",
      );
    // A syntactically valid token is NEVER treated as authenticated.
    return error(
      503,
      "AUTH_NOT_READY",
      "Xác thực nội bộ chưa được triển khai. Truy cập nghiệp vụ đang đóng.",
    );
  };
}
