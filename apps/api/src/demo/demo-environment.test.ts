import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadDemoEnvironment } from "./demo-environment.ts";

const noEnvironmentFile = "C:/definitely-absent-stockwise-demo.env";
const password = "demo-only-credential-12345";
const valid = "postgresql://demo:secret@127.0.0.1:5432/fresh_fixture_demo";

function check(
  databaseUrl: string | undefined,
  other: Record<string, string | undefined> = {},
) {
  return loadDemoEnvironment(
    { DEMO_DATABASE_URL: databaseUrl, DEMO_USER_PASSWORD: password, ...other },
    noEnvironmentFile,
  );
}

describe("demo target guard", () => {
  it("accepts only an explicit distinct loopback _demo target", () => {
    expect(check(valid).databaseName).toBe("fresh_fixture_demo");
  });

  it.each([
    [undefined, /must be supplied/],
    ["not a URL", /safely compared/],
    [
      "postgres://demo:secret@127.0.0.1/fresh_fixture_demo",
      /loopback PostgreSQL/,
    ],
    [
      "postgresql://demo:secret@db.example.com/fresh_fixture_demo",
      /loopback PostgreSQL/,
    ],
    ["postgresql://demo:secret@127.0.0.1/stockwise", /_demo/],
    ["postgresql://demo:secret@127.0.0.1/stockwise_test", /_demo/],
    [
      "postgresql://demo:secret@127.0.0.1/stockwise_test_demo",
      /test or production/,
    ],
    [
      "postgresql://demo:secret@127.0.0.1/stockwise_prod_demo",
      /test or production/,
    ],
    [
      "postgresql://demo:secret@127.0.0.1/fresh_fixture_demo?host=remote",
      /loopback PostgreSQL/,
    ],
    [
      "postgresql://demo:secret@127.0.0.1/fresh_fixture_demo#unsafe",
      /loopback PostgreSQL/,
    ],
    [
      "postgresql://demo:secret@127.0.0.1/fresh_fixture_demo#",
      /loopback PostgreSQL/,
    ],
  ])("rejects an unsafe target", (url, message) => {
    expect(() => check(url)).toThrow(message);
  });

  it("normalizes credentials, loopback aliases, default ports, and encoded names before collision checks", () => {
    expect(() =>
      check(valid, {
        DATABASE_URL:
          "postgresql://other:pass@localhost/fresh%5Ffixture_demo?schema=public",
      }),
    ).toThrow(/collides/);
    expect(() =>
      check(valid, {
        TEST_DATABASE_URL:
          "postgresql://other:pass@[::1]:5432/fresh_fixture_demo",
      }),
    ).toThrow(/collides/);
  });

  it("rejects a collision with the root environment file independently of process DATABASE_URL", () => {
    const directory = mkdtempSync(join(tmpdir(), "stockwise-demo-guard-"));
    const file = join(directory, ".env");
    try {
      writeFileSync(
        file,
        "DATABASE_URL=postgresql://other:pass@localhost/fresh_fixture_demo\n",
      );
      expect(() =>
        loadDemoEnvironment(
          { DEMO_DATABASE_URL: valid, DEMO_USER_PASSWORD: password },
          file,
        ),
      ).toThrow(/root .env DATABASE_URL/);
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
  });

  it("rejects malformed comparison targets, production mode, and invalid credentials", () => {
    expect(() => check(valid, { DATABASE_URL: "not a URL" })).toThrow(
      /safely compared/,
    );
    expect(() => check(valid, { STOCKWISE_RUNTIME_ENV: "production" })).toThrow(
      /production mode/,
    );
    expect(() =>
      loadDemoEnvironment(
        { DEMO_DATABASE_URL: valid, DEMO_USER_PASSWORD: "too short" },
        noEnvironmentFile,
      ),
    ).toThrow(/15 to 128/);
  });
});
