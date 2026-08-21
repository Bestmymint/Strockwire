import { describe, expect, it } from "vitest";

import { apiEnvironmentSchema, loadApiEnvironment } from "./environment.ts";

describe("API environment boundary", () => {
  it("loads the required local loopback port", () => {
    expect(loadApiEnvironment({ STOCKWISE_API_PORT: "3001" })).toEqual({
      STOCKWISE_API_PORT: 3001,
    });
  });

  it("rejects missing, invalid, and unowned configuration", () => {
    expect(() => apiEnvironmentSchema.parse({})).toThrow();
    expect(() =>
      apiEnvironmentSchema.parse({ STOCKWISE_API_PORT: "not-a-port" }),
    ).toThrow();
    expect(() =>
      apiEnvironmentSchema.parse({
        DATABASE_URL: "must-not-be-accepted-yet",
        STOCKWISE_API_PORT: "3001",
      }),
    ).toThrow();
  });
});
