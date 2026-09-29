import { describe, expect, it } from "vitest";

import {
  apiEnvironmentSchema,
  databaseUrlSchema,
  loadApiEnvironment,
} from "./environment.ts";

const analyticsKey = Buffer.alloc(32, 7).toString("base64url");

describe("API environment boundary", () => {
  it("loads the required local API and database configuration", () => {
    expect(
      loadApiEnvironment({
        DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
        STOCKWISE_API_PORT: "3001",
        STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY: analyticsKey,
        STOCKWISE_PUBLIC_WEB_ORIGIN: "http://localhost:3000/",
        STOCKWISE_RUNTIME_ENV: "development",
      }),
    ).toEqual({
      DATABASE_URL:
        "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
      STOCKWISE_RUNTIME_ENV: "development",
      STOCKWISE_EMAIL_PROVIDER: "non_delivery",
      STOCKWISE_API_PORT: 3001,
      STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY: analyticsKey,
      STOCKWISE_PUBLIC_WEB_ORIGIN: "http://localhost:3000",
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
        STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY: analyticsKey,
        STOCKWISE_EMAIL_FROM: "StockWise <verified@example.com>",
        STOCKWISE_PUBLIC_WEB_ORIGIN: "https://stockwise.example.com",
        STOCKWISE_RUNTIME_ENV: "production",
        RESEND_API_KEY: "server-only-resend-key",
        STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES: "20160",
        STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES: "2880",
        STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES: "30",
      }),
    ).toMatchObject({
      STOCKWISE_RUNTIME_ENV: "production",
      STOCKWISE_EMAIL_PROVIDER: "resend",
      STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY: analyticsKey,
      RESEND_API_KEY: "server-only-resend-key",
      STOCKWISE_EMAIL_FROM: "StockWise <verified@example.com>",
      STOCKWISE_PUBLIC_WEB_ORIGIN: "https://stockwise.example.com",
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
        STOCKWISE_PUBLIC_WEB_ORIGIN: "http://localhost:3000",
        STOCKWISE_RUNTIME_ENV: "development",
      }),
    ).toThrow();
    expect(() =>
      apiEnvironmentSchema.parse({
        DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
        STOCKWISE_API_PORT: "3001",
        STOCKWISE_PUBLIC_WEB_ORIGIN: "http://localhost:3000",
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
    expect(() =>
      loadApiEnvironment({
        DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
        STOCKWISE_API_PORT: "3001",
        STOCKWISE_PUBLIC_WEB_ORIGIN: "https://stockwise.example.com",
        STOCKWISE_RUNTIME_ENV: "production",
      }),
    ).toThrow();
  });

  it("requires one canonical stable analytics key in every runtime mode", () => {
    const base = {
      DATABASE_URL:
        "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
      STOCKWISE_API_PORT: "3001",
      STOCKWISE_PUBLIC_WEB_ORIGIN: "http://localhost:3000",
      STOCKWISE_RUNTIME_ENV: "test",
    };
    expect(() => loadApiEnvironment(base)).toThrow();
    for (const key of [
      "short",
      Buffer.alloc(31, 1).toString("base64url"),
      `${analyticsKey}=`,
    ]) {
      expect(() =>
        loadApiEnvironment({
          ...base,
          STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY: key,
        }),
      ).toThrow();
    }
    expect(
      loadApiEnvironment({
        ...base,
        STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY: analyticsKey,
      }).STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY,
    ).toBe(analyticsKey);
  });

  it("validates database-only connectivity without requiring analytics configuration", () => {
    expect(
      databaseUrlSchema.parse(
        "postgresql://local-user@127.0.0.1:5432/local-database",
      ),
    ).toBe("postgresql://local-user@127.0.0.1:5432/local-database");
    expect(() =>
      databaseUrlSchema.parse(
        "mysql://local-user@127.0.0.1:3306/local-database",
      ),
    ).toThrow();
  });

  it("resolves email provider defaults and rejects unsafe runtime combinations", () => {
    const base = {
      DATABASE_URL:
        "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
      STOCKWISE_API_PORT: "3001",
      STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY: analyticsKey,
      STOCKWISE_PUBLIC_WEB_ORIGIN: "http://localhost:3000",
      RESEND_API_KEY: "placeholder-key",
      STOCKWISE_EMAIL_FROM: "StockWise <no-reply@example.com>",
    };
    for (const runtime of ["development", "test"] as const) {
      expect(
        loadApiEnvironment({ ...base, STOCKWISE_RUNTIME_ENV: runtime })
          .STOCKWISE_EMAIL_PROVIDER,
      ).toBe("non_delivery");
    }
    expect(
      loadApiEnvironment({
        ...base,
        STOCKWISE_RUNTIME_ENV: "development",
        STOCKWISE_EMAIL_PROVIDER: "non_delivery",
      }).STOCKWISE_EMAIL_PROVIDER,
    ).toBe("non_delivery");
    expect(
      loadApiEnvironment({
        ...base,
        STOCKWISE_RUNTIME_ENV: "development",
        STOCKWISE_EMAIL_PROVIDER: "resend",
      }).STOCKWISE_EMAIL_PROVIDER,
    ).toBe("resend");
    for (const missing of ["RESEND_API_KEY", "STOCKWISE_EMAIL_FROM"] as const) {
      expect(() =>
        loadApiEnvironment({
          ...base,
          [missing]: undefined,
          STOCKWISE_RUNTIME_ENV: "development",
          STOCKWISE_EMAIL_PROVIDER: "resend",
        }),
      ).toThrow();
    }
    expect(() =>
      loadApiEnvironment({
        ...base,
        STOCKWISE_RUNTIME_ENV: "test",
        STOCKWISE_EMAIL_PROVIDER: "resend",
      }),
    ).toThrow();
    expect(
      loadApiEnvironment({ ...base, STOCKWISE_RUNTIME_ENV: "production" })
        .STOCKWISE_EMAIL_PROVIDER,
    ).toBe("resend");
    expect(
      loadApiEnvironment({
        ...base,
        STOCKWISE_RUNTIME_ENV: "production",
        STOCKWISE_EMAIL_PROVIDER: "resend",
      }).STOCKWISE_EMAIL_PROVIDER,
    ).toBe("resend");
    expect(() =>
      loadApiEnvironment({
        ...base,
        STOCKWISE_RUNTIME_ENV: "production",
        STOCKWISE_EMAIL_PROVIDER: "non_delivery",
      }),
    ).toThrow();
    expect(() =>
      loadApiEnvironment({
        ...base,
        STOCKWISE_RUNTIME_ENV: "production",
        RESEND_API_KEY: undefined,
      }),
    ).toThrow();
    expect(() =>
      loadApiEnvironment({
        ...base,
        STOCKWISE_RUNTIME_ENV: "production",
        STOCKWISE_EMAIL_FROM: undefined,
      }),
    ).toThrow();
    expect(() =>
      loadApiEnvironment({
        ...base,
        STOCKWISE_RUNTIME_ENV: "development",
        STOCKWISE_EMAIL_PROVIDER: "other",
      }),
    ).toThrow();
  });

  it("keeps the optional OpenRouter key server-only and rejects blank or malformed values", () => {
    const base = {
      DATABASE_URL:
        "postgresql://local-user:local-password@127.0.0.1:5432/local-database",
      STOCKWISE_API_PORT: "3001",
      STOCKWISE_ANALYTICS_CURSOR_HMAC_KEY: analyticsKey,
      STOCKWISE_PUBLIC_WEB_ORIGIN: "http://localhost:3000",
      STOCKWISE_RUNTIME_ENV: "development",
    };
    expect(loadApiEnvironment(base).OPENROUTER_API_KEY).toBeUndefined();
    expect(
      loadApiEnvironment({ ...base, OPENROUTER_API_KEY: "server-only-key" })
        .OPENROUTER_API_KEY,
    ).toBe("server-only-key");
    for (const key of ["", " ", "key\nsecret"]) {
      expect(() =>
        loadApiEnvironment({ ...base, OPENROUTER_API_KEY: key }),
      ).toThrow();
    }
    let error: unknown;
    try {
      loadApiEnvironment({ ...base, OPENROUTER_API_KEY: "secret\nvalue" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeDefined();
    expect(String(error)).not.toContain("secret\nvalue");
  });
});
