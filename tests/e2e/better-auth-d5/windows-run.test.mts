import assert from "node:assert/strict";
import { test } from "node:test";
import { digest } from "./source-contract.mts";
import { checkWindowsSourceRequest } from "./windows-run.mts";

const request = JSON.stringify({ files: [], requiredTests: [] });

test("source entrypoint refuses unreviewed request substitution before filesystem reads", async () => {
  await assert.rejects(
    checkWindowsSourceRequest("unused", request, "0".repeat(64), {}),
    /REVIEWED_SOURCE_REQUEST_REQUIRED/,
  );
});

test("source entrypoint has no resource or migration execution request fields", async () => {
  for (const operation of [
    "acquire",
    "bootstrap",
    "migrate",
    "reset",
    "seed",
    "cleanup",
  ]) {
    const bytes = JSON.stringify({ files: [], requiredTests: [], operation });
    await assert.rejects(
      checkWindowsSourceRequest("unused", bytes, digest(bytes), {}),
      /SOURCE_REQUEST_INVALID/,
    );
  }
});

test("source entrypoint checks inherited database configuration before parsing request", async () => {
  await assert.rejects(
    checkWindowsSourceRequest("unused", "not json", "0".repeat(64), {
      database_url: "postgresql://invalid.invalid/never_connect",
    }),
    /WINDOWS_CALLER_ENVIRONMENT_UNSAFE/,
  );
});

test("source entrypoint refuses malformed independent source and test manifest rows", async () => {
  for (const row of [
    { files: [null], requiredTests: [] },
    {
      files: [{ path: "package.json", sha256: "a".repeat(64), extra: true }],
      requiredTests: [],
    },
    { files: [], requiredTests: [{ file: "test.test.mts" }] },
    {
      files: [],
      requiredTests: [
        { file: "test.test.mts", id: "a".repeat(64), discovered: true },
      ],
    },
  ]) {
    const bytes = JSON.stringify(row);
    await assert.rejects(
      checkWindowsSourceRequest("unused", bytes, digest(bytes), {}),
      /SOURCE_REQUEST_INVALID/,
    );
  }
});
