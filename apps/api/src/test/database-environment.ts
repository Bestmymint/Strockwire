import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { z } from "zod";

const TEST_DATABASE_NAME_PATTERN = /^[a-z0-9_]+_test$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);
const environmentFile = fileURLToPath(
  new URL("../../../../.env", import.meta.url),
);

function runtimeDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
  runtimeEnvironmentFile: string,
): string | undefined {
  if (environment.DATABASE_URL !== undefined) return environment.DATABASE_URL;
  if (environment !== process.env || !existsSync(runtimeEnvironmentFile))
    return undefined;

  try {
    return parseEnv(readFileSync(runtimeEnvironmentFile, "utf8")).DATABASE_URL;
  } catch {
    throw new Error(
      "API DATABASE_URL cannot be compared; destructive setup was refused. No database was modified.",
    );
  }
}

export const testDatabaseEnvironmentSchema = z
  .object({
    TEST_DATABASE_URL: z.string().url(),
    STOCKWISE_ALLOW_STOCKWISE_TEST: z.literal("1").optional(),
  })
  .strict();

export type TestDatabaseEnvironment = z.infer<
  typeof testDatabaseEnvironmentSchema
>;

function parseAndValidateTestDatabaseUrl(
  value: string,
  allowStockwiseTest = false,
): URL {
  let url: URL;
  let databaseName: string;
  try {
    url = new URL(value);
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use the postgresql:// protocol.");
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      "TEST_DATABASE_URL must target a loopback PostgreSQL host.",
    );
  }

  if (
    url.searchParams.size > 1 ||
    (url.searchParams.size === 1 && url.searchParams.get("schema") !== "public")
  ) {
    throw new Error(
      "TEST_DATABASE_URL query parameters may contain only schema=public.",
    );
  }

  if (url.hash !== "") {
    throw new Error("TEST_DATABASE_URL must not contain a fragment.");
  }

  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      "TEST_DATABASE_URL must name a disposable database ending in _test.",
    );
  }

  if (databaseName === "stockwise_test" && !allowStockwiseTest) {
    throw new Error(
      "stockwise_test is refused by default. Use a fresh loopback database ending in _test; CI may explicitly set STOCKWISE_ALLOW_STOCKWISE_TEST=1.",
    );
  }

  return url;
}

export function getTestDatabaseName(
  testDatabaseUrl: string,
  allowStockwiseTest = false,
): string {
  return decodeURIComponent(
    parseAndValidateTestDatabaseUrl(
      testDatabaseUrl,
      allowStockwiseTest,
    ).pathname.slice(1),
  );
}

export function getTestDatabaseAdminUrl(
  testDatabaseUrl: string,
  allowStockwiseTest = false,
): string {
  const adminUrl = parseAndValidateTestDatabaseUrl(
    testDatabaseUrl,
    allowStockwiseTest,
  );
  adminUrl.pathname = "/postgres";
  adminUrl.searchParams.delete("schema");

  return adminUrl.toString();
}

export function loadTestDatabaseEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  runtimeEnvironmentFile = environmentFile,
): TestDatabaseEnvironment {
  if (
    environment.TEST_DATABASE_URL === undefined ||
    environment.TEST_DATABASE_URL === ""
  ) {
    throw new Error(
      "TEST_DATABASE_URL must be supplied explicitly for destructive test setup. Use a fresh loopback database ending in _test. No database was modified.",
    );
  }
  if (
    environment.STOCKWISE_ALLOW_STOCKWISE_TEST !== undefined &&
    environment.STOCKWISE_ALLOW_STOCKWISE_TEST !== "1"
  ) {
    throw new Error(
      "STOCKWISE_ALLOW_STOCKWISE_TEST accepts only 1; destructive setup was refused. No database was modified.",
    );
  }

  const parsed = testDatabaseEnvironmentSchema.safeParse({
    TEST_DATABASE_URL: environment.TEST_DATABASE_URL,
    STOCKWISE_ALLOW_STOCKWISE_TEST: environment.STOCKWISE_ALLOW_STOCKWISE_TEST,
  });
  if (!parsed.success) {
    throw new Error(
      "TEST_DATABASE_URL must be a valid PostgreSQL URL; destructive setup was refused. No database was modified.",
    );
  }
  const testEnvironment = parsed.data;

  let testUrl: URL;
  try {
    testUrl = parseAndValidateTestDatabaseUrl(
      testEnvironment.TEST_DATABASE_URL,
      testEnvironment.STOCKWISE_ALLOW_STOCKWISE_TEST === "1",
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : "Invalid TEST_DATABASE_URL."} Destructive setup was refused. No database was modified.`,
      { cause: error },
    );
  }

  const applicationDatabaseUrl = runtimeDatabaseUrl(
    environment,
    runtimeEnvironmentFile,
  );
  if (applicationDatabaseUrl !== undefined) {
    if (!URL.canParse(applicationDatabaseUrl)) {
      throw new Error(
        "API DATABASE_URL cannot be compared; destructive setup was refused. No database was modified.",
      );
    }
    const runtimeUrl = new URL(applicationDatabaseUrl);
    if (runtimeUrl.protocol !== "postgresql:") {
      throw new Error(
        "API DATABASE_URL cannot be compared; destructive setup was refused. No database was modified.",
      );
    }
    let runtimeDatabaseName: string;
    try {
      runtimeDatabaseName = decodeURIComponent(runtimeUrl.pathname.slice(1));
    } catch {
      throw new Error(
        "API DATABASE_URL cannot be compared; destructive setup was refused. No database was modified.",
      );
    }
    const runtimeHost = (
      runtimeUrl.searchParams.get("host") ?? runtimeUrl.hostname
    ).toLowerCase();
    const runtimePort =
      Number.parseInt(
        (runtimeUrl.searchParams.get("port") ?? runtimeUrl.port) || "5432",
        10,
      ) || 5432;
    if (
      LOOPBACK_HOSTS.has(runtimeHost === "::1" ? "[::1]" : runtimeHost) &&
      runtimePort === Number(testUrl.port || "5432") &&
      runtimeDatabaseName === decodeURIComponent(testUrl.pathname.slice(1))
    ) {
      throw new Error(
        "TEST_DATABASE_URL must not equal the API DATABASE_URL. Destructive setup was refused. No database was modified.",
      );
    }
  }

  return testEnvironment;
}
