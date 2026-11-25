import { it, expect } from "vitest";
import { parseConfig } from "../src/lib/config";
it("requires both actual environment values", () => {
  expect(parseConfig({})).toBeNull();
  expect(parseConfig({ VITE_SUPABASE_URL: "https://example.test" })).toBeNull();
});
it("rejects insecure remote backend URLs", () => {
  expect(
    parseConfig({
      VITE_SUPABASE_URL: "http://example.test",
      VITE_SUPABASE_ANON_KEY: "public-test-key",
    }),
  ).toBeNull();
});
it("allows HTTP only on local loopback", () => {
  expect(
    parseConfig({
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_ANON_KEY: "public-test-key",
    }),
  ).not.toBeNull();
});
