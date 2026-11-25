import { z } from "zod";
const schema = z.object({
  url: z.url().refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname))
    );
  }, "URL phải dùng HTTPS hoặc localhost"),
  key: z.string().min(1),
});
export function parseConfig(env: Record<string, unknown>) {
  const result = schema.safeParse({
    url: env.VITE_SUPABASE_URL,
    key: env.VITE_SUPABASE_ANON_KEY,
  });
  return result.success ? result.data : null;
}
export const backendConfig = parseConfig(import.meta.env);
export const appName = import.meta.env.VITE_APP_NAME || "EduManager";
export const centerName =
  import.meta.env.VITE_CENTER_NAME || "Trung tâm Nhật Như";
