import { it, expect, vi } from "vitest";
import { createBootstrapHandler } from "../supabase/functions/bootstrap-admin/handler";
import { AuthError } from "../supabase/functions/edumanager/auth";
const key = "test-service-key-only";
const body = {
  username: "test_admin",
  display_name: "Test",
  password: "TestFixturePassword123!",
};
const request = (credential = "") =>
  new Request("https://example.test/bootstrap-admin", {
    method: "POST",
    headers: { Authorization: "Bearer " + credential },
    body: JSON.stringify(body),
  });
it("bootstrap is disabled by default even with service credential", async () => {
  const rpc = vi.fn();
  const h = createBootstrapHandler({ enabled: false, key }, rpc, vi.fn());
  expect((await h(request(key))).status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
});
it("bootstrap refuses anonymous and normal session credentials before hash or DB work", async () => {
  const rpc = vi.fn(),
    hash = vi.fn();
  const h = createBootstrapHandler({ enabled: true, key }, rpc, hash);
  for (const token of ["", "anon-public-key", "a".repeat(43)])
    expect((await h(request(token))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
  expect(hash).not.toHaveBeenCalled();
});
it("bootstrap sends only hash to database and returns no password", async () => {
  const rpc = vi.fn().mockResolvedValue({ username: "test_admin" });
  const h = createBootstrapHandler(
    { enabled: true, key },
    rpc,
    async () => "$bcrypt-test-hash",
  );
  const res = await h(request(key));
  expect(res.status).toBe(201);
  expect(rpc.mock.calls[0][1]).toEqual({
    p_username: "test_admin",
    p_name: "Test",
    p_hash: "$bcrypt-test-hash",
  });
  expect(await res.text()).not.toContain(body.password);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
});
it("closed bootstrap stays closed", async () => {
  const h = createBootstrapHandler(
    { enabled: true, key },
    async () => {
      throw new AuthError(409, "BOOTSTRAP_CLOSED", "closed");
    },
    async () => "$hash",
  );
  expect((await h(request(key))).status).toBe(409);
});
