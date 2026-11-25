import { hash } from "npm:bcryptjs@3.0.3";
import { restRpc } from "../edumanager/rpc.ts";
import { createBootstrapHandler } from "./handler.ts";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
Deno.serve(
  createBootstrapHandler(
    { enabled: Deno.env.get("BOOTSTRAP_ENABLED") === "true", key },
    restRpc(Deno.env.get("SUPABASE_URL") || "", key),
    (p) => hash(p, 12),
  ),
);
