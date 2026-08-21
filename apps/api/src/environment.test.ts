import { describe, expect, it } from "vitest";

import { apiEnvironmentSchema, loadApiEnvironment } from "./environment.ts";

describe("API environment boundary", () => {
  it("loads the required local API and database configuration", () => {
    expect(
      loadApiEnvironment({
        DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
        STOCKWISE_API_PORT: "3001",
      }),
    ).toEqual({
      DATABASE_URL:
        "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
      STOCKWISE_API_PORT: 3001,
    });
  });

  it("rejects missing, invalid, and unowned configuration", () => {
    expect(() => apiEnvironmentSchema.parse({})).toThrow();
    expect(() =>
      apiEnvironmentSchema.parse({ DATABASE_URL: "not-a-url" }),
    ).toThrow();
    expect(() =>
      apiEnvironmentSchema.parse({
        DATABASE_URL: "mysql://local-user@127.0.0.1:3306/local-database",
        STOCKWISE_API_PORT: "3001",
      }),
    ).toThrow();
    expect(() =>
      apiEnvironmentSchema.parse({
        DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
        STOCKWISE_API_PORT: "3001",
        UNOWNED_VALUE: "must-not-be-accepted",
      }),
    ).toThrow();
  });
});
