import { createClient } from "@supabase/supabase-js";
import { backendConfig } from "./config";
export const supabase = backendConfig
  ? createClient(backendConfig.url, backendConfig.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
// Internal session remains in memory; never use Supabase Auth or localStorage.
let sessionToken: string | null = null;
export function setSessionToken(token: string | null) {
  sessionToken = token;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!backendConfig)
    throw new ApiError(0, "NOT_CONFIGURED", "Chưa cấu hình kết nối Supabase.");
  const headers = new Headers(init.headers);
  headers.set("apikey", backendConfig.key);
  if (init.body) headers.set("Content-Type", "application/json");
  if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
  let response: Response;
  try {
    response = await fetch(
      `${backendConfig.url}/functions/v1/edumanager/v1${path}`,
      { ...init, headers, signal: init.signal ?? AbortSignal.timeout(10000) },
    );
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "Không thể kết nối máy chủ. Kiểm tra mạng và cấu hình backend.",
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) {
      setSessionToken(null);
      window.dispatchEvent(new Event("auth-expired"));
    }
    throw new ApiError(
      response.status,
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? "Máy chủ trả về lỗi.",
    );
  }
  if (!body || !("data" in body))
    throw new ApiError(
      502,
      "INVALID_RESPONSE",
      "Phản hồi máy chủ không hợp lệ.",
    );
  return body.data as T;
}
