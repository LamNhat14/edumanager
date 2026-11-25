import {
  validatePassword,
  fingerprint,
  AuthError,
  type Rpc,
} from "../edumanager/auth.ts";
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
