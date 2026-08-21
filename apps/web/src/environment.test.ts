import { describe, expect, it } from "vitest";

import { loadWebEnvironment, webEnvironmentSchema } from "./environment";

describe("web environment boundary", () => {
  it("loads the server-only loopback API origin", () => {
    expect(
      loadWebEnvironment({ STOCKWISE_API_ORIGIN: "http://127.0.0.1:3001" }),
    ).toEqual({ STOCKWISE_API_ORIGIN: "http://127.0.0.1:3001" });
  });

  it("rejects missing, invalid, and unowned values", () => {
    expect(() => webEnvironmentSchema.parse({})).toThrow();
    expect(() =>
      webEnvironmentSchema.parse({
        STOCKWISE_API_ORIGIN: "https://example.com/health",
      }),
    ).toThrow();
    expect(() =>
      webEnvironmentSchema.parse({
        DATABASE_URL: "must-not-enter-web-config",
        STOCKWISE_API_ORIGIN: "http://127.0.0.1:3001",
      }),
    ).toThrow();
  });
});
