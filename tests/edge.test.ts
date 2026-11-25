import { describe, it, expect } from "vitest";
import { createHandler } from "../supabase/functions/edumanager/handler";
const handler = createHandler(["http://localhost:5173"]);
const req = (path: string, options: RequestInit = {}) =>
  new Request(
    `https://example.test/functions/v1/edumanager/v1${path}`,
    options,
  );
describe("Edge foundation fails closed", () => {
  it("health never claims database or auth ready", async () => {
    const res = await handler(req("/health"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      database: "not_checked",
      authentication: "not_configured",
    });
  });
  it("denies business requests without session", async () => {
    expect((await handler(req("/students"))).status).toBe(401);
  });
  it("never trusts a well-shaped arbitrary token", async () => {
    expect(
      (
        await handler(
          req("/students", {
            headers: { Authorization: `Bearer ${"a".repeat(43)}` },
          }),
        )
      ).status,
    ).toBe(503);
  });
  it("rejects disallowed origins", async () => {
    expect(
      (
        await handler(
          req("/health", { headers: { Origin: "https://untrusted.test" } }),
        )
      ).status,
    ).toBe(403);
  });
  it("permits preflight only for allowed origin", async () => {
    const res = await handler(
      req("/students", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:5173" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173",
    );
  });
  it("does not expose wildcard CORS or cache responses", async () => {
    const res = await handler(req("/health"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects incorrect health methods", async () => {
    expect((await handler(req("/health", { method: "POST" }))).status).toBe(
      405,
    );
  });
  it("rejects a different function prefix", async () => {
    expect(
      (await handler(new Request("https://example.test/other/v1/health")))
        .status,
    ).toBe(404);
  });
});
