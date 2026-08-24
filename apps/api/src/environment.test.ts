import { describe, expect, it } from "vitest";

import { apiEnvironmentSchema, loadApiEnvironment } from "./environment.ts";

describe("API environment boundary", () => {
  it("loads the required local API and database configuration", () => {
    expect(
      loadApiEnvironment({
        DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
        STOCKWISE_API_PORT: "3001",
        STOCKWISE_RUNTIME_ENV: "development",
      }),
    ).toEqual({
      DATABASE_URL:
        "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
      STOCKWISE_RUNTIME_ENV: "development",
      STOCKWISE_API_PORT: 3001,
      STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES: 10_080,
      STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES: 1_440,
      STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES: 15,
    });
  });

  it("loads production cookie mode and configurable session timeouts", () => {
    expect(
      loadApiEnvironment({
        DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
        STOCKWISE_API_PORT: "3001",
        STOCKWISE_RUNTIME_ENV: "production",
        STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES: "20160",
        STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES: "2880",
        STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES: "30",
      }),
    ).toMatchObject({
      STOCKWISE_RUNTIME_ENV: "production",
      STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES: 20_160,
      STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES: 2_880,
      STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES: 30,
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
        STOCKWISE_RUNTIME_ENV: "development",
      }),
    ).toThrow();
    expect(() =>
      apiEnvironmentSchema.parse({
        DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
        STOCKWISE_API_PORT: "3001",
        STOCKWISE_RUNTIME_ENV: "development",
        UNOWNED_VALUE: "must-not-be-accepted",
      }),
    ).toThrow();
    expect(() =>
      loadApiEnvironment({
        DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
        STOCKWISE_API_PORT: "3001",
        STOCKWISE_RUNTIME_ENV: "development",
        STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES: "60",
        STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES: "61",
      }),
    ).toThrow();
  });
});
