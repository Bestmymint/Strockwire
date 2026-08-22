import { z } from "zod";

const TEST_DATABASE_NAME_PATTERN = /^[a-z0-9_]+_test$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export const testDatabaseEnvironmentSchema = z
  .object({
    TEST_DATABASE_URL: z.string().url(),
  })
  .strict();

export type TestDatabaseEnvironment = z.infer<
  typeof testDatabaseEnvironmentSchema
>;

function parseAndValidateTestDatabaseUrl(value: string): URL {
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.slice(1));

  if (url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use the postgresql:// protocol.");
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      "TEST_DATABASE_URL must target a loopback PostgreSQL host.",
    );
  }

  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      "TEST_DATABASE_URL must name a disposable database ending in _test.",
    );
  }

  return url;
}

export function getTestDatabaseName(testDatabaseUrl: string): string {
  return decodeURIComponent(
    parseAndValidateTestDatabaseUrl(testDatabaseUrl).pathname.slice(1),
  );
}

export function getTestDatabaseAdminUrl(testDatabaseUrl: string): string {
  const adminUrl = parseAndValidateTestDatabaseUrl(testDatabaseUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.searchParams.delete("schema");

  return adminUrl.toString();
}

export function loadTestDatabaseEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TestDatabaseEnvironment {
  const testEnvironment = testDatabaseEnvironmentSchema.parse({
    TEST_DATABASE_URL: environment.TEST_DATABASE_URL,
  });

  parseAndValidateTestDatabaseUrl(testEnvironment.TEST_DATABASE_URL);

  if (
    environment.DATABASE_URL !== undefined &&
    new URL(environment.DATABASE_URL).toString() ===
      new URL(testEnvironment.TEST_DATABASE_URL).toString()
  ) {
    throw new Error("TEST_DATABASE_URL must not equal the API DATABASE_URL.");
  }

  return testEnvironment;
}
