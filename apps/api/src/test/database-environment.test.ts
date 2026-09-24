import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getTestDatabaseName,
  loadTestDatabaseEnvironment,
} from "./database-environment.ts";

const safeUrl =
  "postgresql://local-user:sensitive-password@127.0.0.1:5432/stockwise_harness_guard_20260924_test";
const staleUrl =
  "postgresql://local-user:sensitive-password@127.0.0.1:5432/stockwise_test";

vi.mock("./database-harness.ts", () => ({
  applyTestDatabaseMigrations: vi.fn(),
  provisionTestDatabase: vi.fn(),
  resetTestDatabase: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("destructive test database target", () => {
  it("rejects a missing explicit target with actionable, credential-free guidance", () => {
    expect(() => loadTestDatabaseEnvironment({})).toThrow(
      /supplied explicitly.*fresh loopback database ending in _test.*No database was modified/,
    );
    expect(() => loadTestDatabaseEnvironment({})).not.toThrow(
      /sensitive-password/,
    );
  });

  it("does not load a target available only in .env before destructive setup", async () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    const loadEnvFile = vi
      .spyOn(process, "loadEnvFile")
      .mockImplementation(() => {});
    const harness = await import("./database-harness.ts");
    const { default: setupDatabaseTests } =
      await import("./database-global-setup.ts");

    await expect(setupDatabaseTests()).rejects.toThrow(
      /TEST_DATABASE_URL must be supplied explicitly/,
    );
    expect(loadEnvFile).not.toHaveBeenCalled();
    expect(harness.provisionTestDatabase).not.toHaveBeenCalled();
    expect(harness.applyTestDatabaseMigrations).not.toHaveBeenCalled();
    expect(harness.resetTestDatabase).not.toHaveBeenCalled();
  });

  it("accepts an explicit fresh loopback database ending in _test", () => {
    const environment = loadTestDatabaseEnvironment({
      TEST_DATABASE_URL: `${safeUrl}?schema=public`,
    });
    expect(getTestDatabaseName(environment.TEST_DATABASE_URL)).toBe(
      "stockwise_harness_guard_20260924_test",
    );
  });

  it("accepts the IPv6 loopback URL form", () => {
    expect(() =>
      loadTestDatabaseEnvironment({
        TEST_DATABASE_URL:
          "postgresql://local:secret@[::1]:5432/ipv6_guard_test",
      }),
    ).not.toThrow();
  });

  it.each([
    [
      "development database",
      "postgresql://local:secret@127.0.0.1:5432/stockwise_dev",
      /ending in _test/,
    ],
    [
      "remote target",
      "postgresql://local:secret@example.com:5432/remote_test",
      /loopback/,
    ],
    [
      "wrong protocol",
      "mysql://local:secret@127.0.0.1:5432/other_test",
      /postgresql:\/\//,
    ],
    ["malformed URL", "not-a-url-sensitive-password", /valid PostgreSQL URL/],
  ])("rejects %s before database access", (_name, url, reason) => {
    expect(() =>
      loadTestDatabaseEnvironment({ TEST_DATABASE_URL: url }),
    ).toThrow(reason);
  });

  it("rejects a runtime database target even when URL options differ", () => {
    expect(() =>
      loadTestDatabaseEnvironment({
        DATABASE_URL: `${safeUrl}?schema=other`,
        TEST_DATABASE_URL: safeUrl,
      }),
    ).toThrow(/must not equal/);
  });

  it("rejects the same runtime database with an omitted default port and encoded name", () => {
    expect(() =>
      loadTestDatabaseEnvironment({
        DATABASE_URL:
          "postgresql://other-user:other-password@localhost/same_database_test?schema=other",
        TEST_DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/same%5Fdatabase_test?schema=public",
      }),
    ).toThrow(/must not equal/);
  });

  it("compares an explicit target with the runtime URL in .env without accepting its test URL", () => {
    const environmentFile = join(
      tmpdir(),
      `stockwise-guard-${randomUUID()}.env`,
    );
    writeFileSync(
      environmentFile,
      `DATABASE_URL=${safeUrl}\nTEST_DATABASE_URL=${staleUrl}\n`,
    );
    vi.stubEnv("TEST_DATABASE_URL", safeUrl);
    vi.stubEnv("DATABASE_URL", undefined);
    try {
      expect(() =>
        loadTestDatabaseEnvironment(process.env, environmentFile),
      ).toThrow(/must not equal/);
    } finally {
      unlinkSync(environmentFile);
    }
  });

  it("rejects a runtime URL whose connection options resolve to the test database", () => {
    expect(() =>
      loadTestDatabaseEnvironment({
        DATABASE_URL:
          "postgresql://other-user:other-password@remote.example.com:6543/same_database_test?host=localhost&port=5432",
        TEST_DATABASE_URL:
          "postgresql://local-user:local-password@127.0.0.1:5432/same_database_test",
      }),
    ).toThrow(/must not equal/);
  });

  it.each([
    ["host override", "?host=remote.example.com"],
    ["port override", "?port=6543"],
    ["extra host override", "?schema=public&host=remote.example.com"],
    ["non-public schema", "?schema=private"],
    ["fragment", "#unexpected"],
  ])("rejects %s before any connection", (_name, suffix) => {
    expect(() =>
      loadTestDatabaseEnvironment({ TEST_DATABASE_URL: `${safeUrl}${suffix}` }),
    ).toThrow(/query parameters|fragment/);
  });

  it("denies the known stale stockwise_test by default and accepts CI opt-in", () => {
    expect(() =>
      loadTestDatabaseEnvironment({ TEST_DATABASE_URL: staleUrl }),
    ).toThrow(/stockwise_test is refused by default/);
    const environment = loadTestDatabaseEnvironment({
      STOCKWISE_ALLOW_STOCKWISE_TEST: "1",
      TEST_DATABASE_URL: staleUrl,
    });
    expect(getTestDatabaseName(environment.TEST_DATABASE_URL, true)).toBe(
      "stockwise_test",
    );
    expect(() =>
      loadTestDatabaseEnvironment({
        STOCKWISE_ALLOW_STOCKWISE_TEST: "1",
        TEST_DATABASE_URL: `${staleUrl}?host=remote.example.com`,
      }),
    ).toThrow(/query parameters/);
    expect(() =>
      loadTestDatabaseEnvironment({
        DATABASE_URL: staleUrl,
        STOCKWISE_ALLOW_STOCKWISE_TEST: "1",
        TEST_DATABASE_URL: staleUrl,
      }),
    ).toThrow(/must not equal/);
  });

  it("accepts only the exact opt-in value 1", () => {
    expect(() =>
      loadTestDatabaseEnvironment({
        STOCKWISE_ALLOW_STOCKWISE_TEST: "false",
        TEST_DATABASE_URL: staleUrl,
      }),
    ).toThrow(/accepts only 1/);
  });

  it("never includes credentials in unsafe-target errors", () => {
    for (const target of [
      staleUrl,
      safeUrl.replace("127.0.0.1", "example.com"),
    ]) {
      try {
        loadTestDatabaseEnvironment({ TEST_DATABASE_URL: target });
      } catch (error) {
        expect(String(error)).not.toContain("sensitive-password");
        expect(String(error)).toContain("No database was modified");
      }
    }
  });
});
