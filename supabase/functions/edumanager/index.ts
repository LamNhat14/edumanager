import { createHandler } from "./handler.ts";
import { createAuth } from "./auth.ts";
import { restRpc } from "./rpc.ts";
import { hash, compare } from "npm:bcryptjs@3.0.3";
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim());
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const secret = Deno.env.get("APP_SESSION_SECRET");
const auth =
  url && key && secret && secret.length >= 32
    ? createAuth(
        restRpc(url, key),
        { hash: (p) => hash(p, 12), compare },
        secret,
      )
    : undefined;
Deno.serve(createHandler(allowedOrigins, auth));
