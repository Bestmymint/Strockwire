import { expect, test } from "vitest";
import {
  localDatabaseFromEnvironment,
  validateHarnessAuthorization,
} from "./runtime.ts";

test("authorization validation accepts the isolated marker and exact harness-owned prompt marker", () => {
  expect(
    validateHarnessAuthorization({
      STOCKWISE_D4N3_ISOLATED: "1",
      PLAYWRIGHT_NO_COPY_PROMPT: "1",
    }),
  ).toEqual({ STOCKWISE_D4N3_ISOLATED: "1" });
});

test("authorization validation rejects missing or invalid isolation markers", () => {
  expect(() => validateHarnessAuthorization({})).toThrow();
  expect(() =>
    validateHarnessAuthorization({ STOCKWISE_D4N3_ISOLATED: "not-authorized" }),
  ).toThrow();
});

test("authorization validation rejects inherited database configuration", () => {
  expect(() =>
    validateHarnessAuthorization({
      STOCKWISE_D4N3_ISOLATED: "1",
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
    }),
  ).toThrow();
});

test("authorization validation rejects inherited provider credentials", () => {
  expect(() =>
    validateHarnessAuthorization({
      STOCKWISE_D4N3_ISOLATED: "1",
      RESEND_API_KEY: "synthetic-not-a-provider-secret",
    }),
  ).toThrow();
});

test("authorization validation rejects alternate browser artifact and debug markers", () => {
  for (const environment of [
    { PLAYWRIGHT_NO_COPY_PROMPT: "0" },
    { PWDEBUG: "1" },
    { PLAYWRIGHT_TEST: "other" },
  ]) {
    expect(() =>
      validateHarnessAuthorization({
        STOCKWISE_D4N3_ISOLATED: "1",
        ...environment,
      }),
    ).toThrow();
  }
});

test("local database continuation rejects malformed receipts and mismatched targets", () => {
  const receipt = {
    owner: "6c1becd5-6c75-41c4-95ef-892c78081162",
    runId: "81e7b7c5-773b-45dc-97cb-628dd0495d53",
    database: "stockwise_test",
    testDatabase: "stockwise_test_test",
    host: "127.0.0.1",
    port: "54321",
    marker: "a".repeat(43),
  };
  const environment = {
    STOCKWISE_LOCAL_DATABASE_RECEIPT: JSON.stringify(receipt),
    DATABASE_URL:
      "postgresql://synthetic:synthetic@127.0.0.1:54321/stockwise_test",
    TEST_DATABASE_URL:
      "postgresql://synthetic:synthetic@127.0.0.1:54321/stockwise_test_test",
  };
  for (const overrides of [
    { STOCKWISE_LOCAL_DATABASE_RECEIPT: "{" },
    { STOCKWISE_LOCAL_DATABASE_RECEIPT: "null" },
    { TEST_DATABASE_URL: undefined },
    {
      TEST_DATABASE_URL:
        "postgresql://synthetic:synthetic@example.invalid:54321/stockwise_test_test",
    },
    {
      TEST_DATABASE_URL:
        "postgresql://synthetic:synthetic@127.0.0.1:54322/stockwise_test_test",
    },
    {
      TEST_DATABASE_URL:
        "postgresql://synthetic:synthetic@127.0.0.1:54321/stockwise",
    },
  ])
    expect(() =>
      localDatabaseFromEnvironment({ ...environment, ...overrides }),
    ).toThrow();
});
