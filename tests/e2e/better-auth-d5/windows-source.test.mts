import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest, type SourceEntry } from "./source-contract.mts";
import {
  assertWindowsSourcePass,
  captureWindowsSource,
  createWindowsSourceReceipt,
  executeWindowsChild,
  executeWindowsMigrations,
  sanitizeWindowsEnvironment,
  snapshotWindowsSource,
  validateWindowsEnvironment,
  verifyWindowsSource,
  windowsSourceManifest,
  type RequiredWindowsTest,
} from "./windows-source.mts";

const migration = "20261017090000_windows_source_binding";
const requiredTests: RequiredWindowsTest[] = [
  {
    id: "a".repeat(64),
    file: "tests/e2e/better-auth-d5/windows-source.test.mts",
  },
];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "d5-windows-source-"));
  const files: Record<string, string> = {
    "package.json": "{}\n",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "apps/api/prisma/schema.prisma": "generator client {}\n",
    "tests/e2e/better-auth-d5/windows-source.test.mts": "test fixture\n",
    "apps/api/prisma/migrations/migration_lock.toml":
      'provider = "postgresql"\n',
    [`apps/api/prisma/migrations/${migration}/migration.sql`]: "SELECT 1;\n",
  };
  for (const [path, bytes] of Object.entries(files)) {
    const full = join(root, ...path.split("/"));
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, bytes);
  }
  const approved: SourceEntry[] = Object.entries(files)
    .map(([path, bytes]) => ({ path, sha256: digest(bytes) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { root, files, approved };
}

test("rejects inherited database URLs, PostgreSQL settings, Docker overrides, and secret-bearing keys before scrubbing", () => {
  for (const key of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "PGHOST",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_OTHER",
    "COMPOSE_FILE",
    "NODE_OPTIONS",
    "NODE_PATH",
    "TSX_TSCONFIG_PATH",
    "MAIL_API_KEY",
    "AUTH_SECRET",
    "MAIL_PROVIDER",
  ]) {
    assert.throws(
      () =>
        validateWindowsEnvironment({ PATH: "safe", [key]: "must-not-inherit" }),
      /WINDOWS_CALLER_ENVIRONMENT_UNSAFE/,
    );
    assert.throws(
      () => sanitizeWindowsEnvironment({ [key]: "must-not-inherit" }),
      /WINDOWS_CALLER_ENVIRONMENT_UNSAFE/,
    );
  }
  validateWindowsEnvironment({
    STOCKWISE_D5_R2_REQUEST: "external",
    STOCKWISE_D5_R2_REQUEST_SHA256: "external",
  });
  const safe = sanitizeWindowsEnvironment({
    PATH: "safe",
    SystemRoot: "C:\\Windows",
    STOCKWISE_D5_R2_REQUEST: "external",
  });
  assert.deepEqual(safe, { PATH: "safe", SystemRoot: "C:\\Windows" });
});

test("sanitizes Windows environment aliases and refuses conflicting executable search paths", () => {
  assert.deepEqual(
    sanitizeWindowsEnvironment({ Path: "safe", SYSTEMROOT: "C:\\Windows" }),
    { PATH: "safe", SystemRoot: "C:\\Windows" },
  );
  assert.throws(
    () => sanitizeWindowsEnvironment({ Path: "safe", PATH: "different" }),
    /WINDOWS_ENVIRONMENT_ALIAS_CONFLICT/,
  );
  assert.throws(
    () => validateWindowsEnvironment({ test_database_url: "must-not-inherit" }),
    /WINDOWS_CALLER_ENVIRONMENT_UNSAFE/,
  );
});

test("requires independently supplied nonempty unique test IDs and approved test files", async () => {
  const { root, approved } = await fixture();
  try {
    await assert.rejects(
      captureWindowsSource(root, approved, []),
      /WINDOWS_REQUIRED_TESTS_MISSING/,
    );
    await assert.rejects(
      captureWindowsSource(root, approved, [
        requiredTests[0]!,
        requiredTests[0]!,
      ]),
      /WINDOWS_REQUIRED_TESTS_INVALID/,
    );
    await assert.rejects(
      captureWindowsSource(
        root,
        approved.filter((item) => item.path !== requiredTests[0]!.file),
        requiredTests,
      ),
      /WINDOWS_SOURCE_REQUIRED_FILE_MISSING/,
    );
    await writeFile(join(root, ...requiredTests[0]!.file.split("/")), "");
    const emptyTest = approved.map((entry) =>
      entry.path === requiredTests[0]!.file
        ? { ...entry, sha256: digest("") }
        : entry,
    );
    await assert.rejects(
      captureWindowsSource(root, emptyTest, requiredTests),
      /WINDOWS_REQUIRED_TEST_FILE_EMPTY/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("captures exact source and migration inventories, catches drift, and copies only to a fresh destination", async () => {
  const { root, approved } = await fixture();
  const destination = join(
    root,
    "..",
    `d5-copy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  try {
    const snapshot = await captureWindowsSource(root, approved, requiredTests);
    const manifest = windowsSourceManifest(snapshot);
    assert.equal(manifest.files.length, approved.length);
    assert.equal(manifest.migration.migrations.length, 1);
    assert.equal(manifest.sourceSha256, digest(JSON.stringify(approved)));
    assert.equal(
      manifest.migrationSha256,
      digest(JSON.stringify(manifest.migration)),
    );
    await snapshotWindowsSource(snapshot, destination);
    assert.equal(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(join(destination, "package.json"), "utf8"),
      ),
      "{}\n",
    );
    await assert.rejects(snapshotWindowsSource(snapshot, destination));
    await verifyWindowsSource(snapshot, root);
    await writeFile(
      join(root, "apps/api/prisma/migrations", migration, "migration.sql"),
      "SELECT 2;\n",
    );
    await assert.rejects(
      verifyWindowsSource(snapshot, root),
      /WINDOWS_SOURCE_DRIFT|WINDOWS_MIGRATION_DRIFT/,
    );
    await assert.rejects(
      captureWindowsSource(root, approved, requiredTests),
      /WINDOWS_MIGRATION_INVENTORY_MISMATCH|WINDOWS_SOURCE_MANIFEST_MISMATCH/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  }
});

test("rejects forbidden environment files and migration execution remains unavailable", async () => {
  const { root, approved } = await fixture();
  try {
    await writeFile(join(root, ".env.local"), "SECRET=value\n");
    await assert.rejects(
      captureWindowsSource(
        root,
        [
          ...approved,
          { path: ".env.local", sha256: digest("SECRET=value\n") },
        ].sort((a, b) => a.path.localeCompare(b.path)),
        requiredTests,
      ),
      /WINDOWS_SOURCE_INVENTORY_INVALID/,
    );
    assert.throws(
      () => executeWindowsMigrations(),
      /WINDOWS_MIGRATION_EXECUTION_UNAVAILABLE/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records real exit and timeout outcomes without retaining child output", async () => {
  const environment = sanitizeWindowsEnvironment({
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  });
  const common = {
    executable: process.execPath,
    cwd: process.cwd(),
    environment,
    maxBuffer: 1024,
    timeoutMs: 3_000,
  };
  const failed = await executeWindowsChild({
    ...common,
    args: ["-e", "process.stdout.write('secret-output'); process.exit(7)"],
  });
  assert.equal(failed.status, "FAIL");
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.signal, null);
  assert.equal(JSON.stringify(failed).includes("secret-output"), false);
  const timeout = await executeWindowsChild({
    ...common,
    timeoutMs: 50,
    args: ["-e", "setTimeout(() => {}, 5000)"],
  });
  assert.equal(timeout.status, "TIMEOUT");
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.exitCode, null);
  const spawnFailure = await executeWindowsChild({
    ...common,
    args: [],
    launcher: () => {
      throw new Error("launch failure");
    },
  });
  assert.equal(spawnFailure.status, "SPAWN_FAILED");
  assert.equal(spawnFailure.exitCode, null);
});

test("receipts require exact discovered and executed IDs, required stages, true process outcomes, and complete cleanup", async () => {
  const { root, approved } = await fixture();
  try {
    const snapshot = await captureWindowsSource(root, approved, requiredTests);
    await verifyWindowsSource(snapshot, root);
    const okProcess = {
      status: "PASS" as const,
      exitCode: 0,
      signal: null,
      timedOut: false,
      spawnError: null,
      stdoutBytes: 0,
      stderrBytes: 0,
    };
    const testStage = [
      { stage: "tests", status: "PASS" as const, process: okProcess },
    ];
    const id = requiredTests[0]!.id;
    const missingProcess = createWindowsSourceReceipt(
      snapshot,
      [{ stage: "tests", status: "NOT_RUN", process: null }],
      "COMPLETE",
      [id],
      [{ id, status: "NOT_RUN" }],
      ["tests"],
    );
    assert.equal(missingProcess.state, "INCOMPLETE");
    assert.throws(() => assertWindowsSourcePass(missingProcess));
    const discoveredButNotRun = createWindowsSourceReceipt(
      snapshot,
      testStage,
      "COMPLETE",
      [id],
      [],
      ["tests"],
    );
    assert.equal(discoveredButNotRun.state, "INCOMPLETE");
    const mismatch = createWindowsSourceReceipt(
      snapshot,
      testStage,
      "COMPLETE",
      ["b".repeat(64)],
      [{ id, status: "PASS" }],
      ["tests"],
    );
    assert.notEqual(mismatch.state, "PASS");
    const omittedStage = createWindowsSourceReceipt(
      snapshot,
      testStage,
      "COMPLETE",
      [id],
      [{ id, status: "PASS" }],
      ["source", "tests"],
    );
    assert.notEqual(omittedStage.state, "PASS");
    const falseProcess = { ...okProcess, exitCode: 7 };
    const falsePass = createWindowsSourceReceipt(
      snapshot,
      [{ stage: "tests", status: "PASS", process: falseProcess }],
      "COMPLETE",
      [id],
      [{ id, status: "PASS" }],
      ["tests"],
    );
    assert.notEqual(falsePass.state, "PASS");
    const pass = createWindowsSourceReceipt(
      snapshot,
      testStage,
      "COMPLETE",
      [id],
      [{ id, status: "PASS" }],
      ["tests"],
    );
    assert.equal(pass.state, "PASS");
    assertWindowsSourcePass(pass);
    assert.notEqual(
      createWindowsSourceReceipt(
        snapshot,
        testStage,
        "INCOMPLETE",
        [id],
        [{ id, status: "PASS" }],
        ["tests"],
      ).state,
      "PASS",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source inventory rejects private credential files and Windows device or case aliases before capture", async () => {
  const { root, approved } = await fixture();
  try {
    for (const path of [
      "credentials.json",
      "secrets.yaml",
      "apps/api/CON.json",
      "apps/api/file .json.",
      "Package.json",
    ]) {
      const entries = [...approved, { path, sha256: digest("unread") }].sort(
        (a, b) => a.path.localeCompare(b.path),
      );
      await assert.rejects(
        captureWindowsSource(root, entries, requiredTests),
        /WINDOWS_SOURCE_INVENTORY_INVALID/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
