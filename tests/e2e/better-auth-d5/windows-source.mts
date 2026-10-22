import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, win32 } from "node:path";
import {
  allowedSourcePath,
  digest,
  type SourceEntry,
} from "./source-contract.mts";
import {
  readMigrationSourceManifest,
  type MigrationSourceManifest,
} from "./migration-contract.mts";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const snapshots = new WeakMap<
  WindowsSourceSnapshot,
  {
    entries: SourceEntry[];
    files: Map<string, Buffer>;
    requiredTests: RequiredWindowsTest[];
    migration: MigrationSourceManifest;
    sha256: string;
    checks: number;
  }
>();

export interface RequiredWindowsTest {
  id: string;
  file: string;
}
export interface WindowsSourceManifest {
  files: SourceEntry[];
  sourceSha256: string;
  migration: MigrationSourceManifest;
  migrationSha256: string;
  requiredTests: RequiredWindowsTest[];
}
export class WindowsSourceSnapshot {}
const forbiddenEnvironmentKey =
  /^(?:.*DATABASE_URL|PG[A-Z0-9_]*|DOCKER[A-Z0-9_]*|COMPOSE[A-Z0-9_]*|NODE_[A-Z0-9_]*|TSX[A-Z0-9_]*)$|(?:API[_]?KEY|ACCESS[_]?KEY|(?:^|_)KEY(?:_|$)|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE[_]?KEY|SMTP|EMAIL|PROVIDER)/i;

/** Inspect the real caller environment before any child-environment sanitization. */
export function validateWindowsEnvironment(
  environment: NodeJS.ProcessEnv,
): void {
  for (const key of Object.keys(environment)) {
    if (forbiddenEnvironmentKey.test(key))
      throw new Error("WINDOWS_CALLER_ENVIRONMENT_UNSAFE");
  }
}

/** Build a child environment only after validating the untouched invoking environment. */
export function sanitizeWindowsEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  validateWindowsEnvironment(environment);
  const safe: NodeJS.ProcessEnv = {};
  const allowed = new Map(
    ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE"].map(
      (key) => [key.toLowerCase(), key],
    ),
  );
  for (const [key, value] of Object.entries(environment)) {
    const canonical = allowed.get(key.toLowerCase());
    if (canonical && value !== undefined) {
      if (safe[canonical] !== undefined && safe[canonical] !== value)
        throw new Error("WINDOWS_ENVIRONMENT_ALIAS_CONFLICT");
      safe[canonical] = value;
    }
  }
  return safe;
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function windowsSourcePath(path: string): boolean {
  return (
    allowedSourcePath(path) &&
    !path
      .split("/")
      .some(
        (part) =>
          /[<>:"|?*]|\p{Cc}/u.test(part) ||
          /[. ]$/.test(part) ||
          /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
      ) &&
    !/(?:^|\/)(?:credentials?|secrets?|service[-_]account|client[-_]secret[^/]*)\.(?:json|ya?ml|toml)$/i.test(
      path,
    )
  );
}
function sameStat(
  a: Awaited<ReturnType<typeof lstat>>,
  b: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}
// Node lstat reports symbolic links and junctions as links; other reparse tags are not portably exposed here.
// This check is for the trusted-user accidental-error model, not a hostile filesystem producer.
function rejectReparse(stat: Awaited<ReturnType<typeof lstat>>): void {
  if (stat.isSymbolicLink())
    throw new Error("WINDOWS_SOURCE_REPARSE_POINT_REJECTED");
}
async function assertMigrationReadBounds(directory: string): Promise<void> {
  const root = await lstat(directory);
  rejectReparse(root);
  if (!root.isDirectory()) throw new Error("WINDOWS_MIGRATION_ROOT_INVALID");
  const members = await readdir(directory, { withFileTypes: true });
  if (members.length > 10_001)
    throw new Error("WINDOWS_MIGRATION_INVENTORY_TOO_LARGE");
  let total = 0;
  const account = async (path: string) => {
    const stat = await lstat(path);
    rejectReparse(stat);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
      throw new Error("WINDOWS_MIGRATION_FILE_INVALID");
    total += stat.size;
    if (total > MAX_TOTAL_BYTES)
      throw new Error("WINDOWS_MIGRATION_INVENTORY_TOO_LARGE");
  };
  for (const member of members) {
    const path = join(directory, member.name);
    if (member.name === "migration_lock.toml") {
      await account(path);
      continue;
    }
    const stat = await lstat(path);
    rejectReparse(stat);
    if (!stat.isDirectory())
      throw new Error("WINDOWS_MIGRATION_MEMBER_INVALID");
    const children = await readdir(path, { withFileTypes: true });
    if (children.length !== 1 || children[0]?.name !== "migration.sql")
      throw new Error("WINDOWS_MIGRATION_MEMBER_INVALID");
    await account(join(path, "migration.sql"));
  }
}

async function readRegularFile(
  root: string,
  relative: string,
): Promise<Buffer> {
  const parts = relative.split("/");
  let current = root;
  const ancestors: { path: string; stat: Awaited<ReturnType<typeof lstat>> }[] =
    [];
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const directory = await lstat(current);
    rejectReparse(directory);
    if (!directory.isDirectory())
      throw new Error("WINDOWS_SOURCE_PATH_NOT_DIRECTORY");
    ancestors.push({ path: current, stat: directory });
  }
  const path = join(root, ...parts);
  const before = await lstat(path);
  rejectReparse(before);
  if (!before.isFile() || before.size > MAX_FILE_BYTES)
    throw new Error("WINDOWS_SOURCE_FILE_INVALID");
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error("WINDOWS_SOURCE_CHANGED_DURING_CAPTURE");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!bytesRead) throw new Error("WINDOWS_SOURCE_CHANGED_DURING_CAPTURE");
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, bytes.length)).bytesRead !== 0)
      throw new Error("WINDOWS_SOURCE_CHANGED_DURING_CAPTURE");
    const after = await handle.stat();
    const anchored = await lstat(path);
    rejectReparse(anchored);
    if (
      !sameStat(opened, after) ||
      !sameStat(before, anchored) ||
      bytes.length !== before.size
    )
      throw new Error("WINDOWS_SOURCE_CHANGED_DURING_CAPTURE");
    for (const ancestor of ancestors) {
      const currentDirectory = await lstat(ancestor.path);
      rejectReparse(currentDirectory);
      if (
        !currentDirectory.isDirectory() ||
        !sameStat(ancestor.stat, currentDirectory)
      )
        throw new Error("WINDOWS_SOURCE_CHANGED_DURING_CAPTURE");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function validateRequiredTests(
  tests: readonly RequiredWindowsTest[],
): RequiredWindowsTest[] {
  if (!Array.isArray(tests) || tests.length === 0 || tests.length > 10_000)
    throw new Error("WINDOWS_REQUIRED_TESTS_MISSING");
  const ids = new Set<string>();
  const result = tests.map((item) => {
    if (
      !item ||
      !/^[a-f0-9]{64}$/.test(item.id) ||
      !windowsSourcePath(item.file) ||
      !/\.test\.mts$/.test(item.file) ||
      ids.has(item.id)
    )
      throw new Error("WINDOWS_REQUIRED_TESTS_INVALID");
    ids.add(item.id);
    return { id: item.id, file: item.file };
  });
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/** Capture exactly the independently approved byte inventory; no git discovery or execution occurs here. */
export async function captureWindowsSource(
  root: string,
  approved: readonly SourceEntry[],
  requiredTests: readonly RequiredWindowsTest[],
): Promise<WindowsSourceSnapshot> {
  const tests = validateRequiredTests(requiredTests);
  if (
    !Array.isArray(approved) ||
    approved.length === 0 ||
    approved.length > 10_000 ||
    new Set(approved.map((entry) => entry.path.toLowerCase())).size !==
      approved.length ||
    approved.some(
      (entry, i) =>
        !entry ||
        !windowsSourcePath(entry.path) ||
        !validHash(entry.sha256) ||
        (i > 0 && approved[i - 1]!.path >= entry.path),
    )
  )
    throw new Error("WINDOWS_SOURCE_INVENTORY_INVALID");
  const expected = approved.map((entry) => ({
    path: entry.path,
    sha256: entry.sha256,
  }));
  const requiredPaths = [
    "package.json",
    "pnpm-lock.yaml",
    "apps/api/prisma/schema.prisma",
  ];
  if (
    requiredPaths.some(
      (path) => !expected.some((entry) => entry.path === path),
    ) ||
    tests.some((test) => !expected.some((entry) => entry.path === test.file))
  )
    throw new Error("WINDOWS_SOURCE_REQUIRED_FILE_MISSING");
  const base = resolve(root);
  const rootStat = await lstat(base);
  rejectReparse(rootStat);
  if (!rootStat.isDirectory()) throw new Error("WINDOWS_SOURCE_ROOT_INVALID");
  const migrationDirectory = join(base, "apps/api/prisma/migrations");
  await assertMigrationReadBounds(migrationDirectory);
  const migration = await readMigrationSourceManifest(migrationDirectory);
  const migrationPaths = new Set([
    "apps/api/prisma/migrations/migration_lock.toml",
    ...migration.migrations.map(
      (item) => `apps/api/prisma/migrations/${item.name}/migration.sql`,
    ),
  ]);
  const suppliedMigrationPaths = new Set(
    expected
      .filter((item) => item.path.startsWith("apps/api/prisma/migrations/"))
      .map((item) => item.path),
  );
  if (
    migrationPaths.size !== suppliedMigrationPaths.size ||
    [...migrationPaths].some((path) => !suppliedMigrationPaths.has(path))
  )
    throw new Error("WINDOWS_MIGRATION_INVENTORY_MISMATCH");
  const files = new Map<string, Buffer>();
  let total = 0;
  for (const entry of expected) {
    const bytes = await readRegularFile(base, entry.path);
    if (tests.some((test) => test.file === entry.path) && bytes.length === 0)
      throw new Error("WINDOWS_REQUIRED_TEST_FILE_EMPTY");
    if (digest(bytes) !== entry.sha256)
      throw new Error("WINDOWS_SOURCE_MANIFEST_MISMATCH");
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES)
      throw new Error("WINDOWS_SOURCE_SNAPSHOT_TOO_LARGE");
    files.set(entry.path, bytes);
  }
  const migrationFiles = migration.migrations.map((item) => ({
    path: `apps/api/prisma/migrations/${item.name}/migration.sql`,
    sha256: item.sha256,
  }));
  for (const item of migrationFiles) {
    const bytes = files.get(item.path);
    if (!bytes || digest(bytes) !== item.sha256)
      throw new Error("WINDOWS_MIGRATION_INVENTORY_MISMATCH");
  }
  const lockBytes = files.get("apps/api/prisma/migrations/migration_lock.toml");
  if (!lockBytes || digest(lockBytes) !== migration.lockSha256)
    throw new Error("WINDOWS_MIGRATION_INVENTORY_MISMATCH");
  for (const entry of expected) {
    const after = await readRegularFile(base, entry.path);
    const captured = files.get(entry.path);
    if (!captured || !after.equals(captured))
      throw new Error("WINDOWS_SOURCE_CHANGED_DURING_CAPTURE");
  }
  await assertMigrationReadBounds(migrationDirectory);
  const migrationAfter = await readMigrationSourceManifest(
    join(base, "apps/api/prisma/migrations"),
  );
  const rootAfter = await lstat(base);
  rejectReparse(rootAfter);
  if (
    !sameStat(rootStat, rootAfter) ||
    JSON.stringify(migrationAfter) !== JSON.stringify(migration)
  )
    throw new Error("WINDOWS_SOURCE_CHANGED_DURING_CAPTURE");
  const entries = expected;
  const snapshot = new WindowsSourceSnapshot();
  snapshots.set(snapshot, {
    entries,
    files,
    requiredTests: tests,
    migration,
    sha256: digest(JSON.stringify(entries)),
    checks: 1,
  });
  return snapshot;
}

function stateOf(snapshot: WindowsSourceSnapshot) {
  const state = snapshots.get(snapshot);
  if (!state) throw new Error("WINDOWS_VERIFIED_SOURCE_REQUIRED");
  return state;
}
export function windowsSourceManifest(
  snapshot: WindowsSourceSnapshot,
): WindowsSourceManifest {
  const state = stateOf(snapshot);
  return {
    files: state.entries.map((entry) => ({ ...entry })),
    sourceSha256: state.sha256,
    migration: {
      migrations: state.migration.migrations.map((entry) => ({ ...entry })),
      lockSha256: state.migration.lockSha256,
    },
    migrationSha256: digest(JSON.stringify(state.migration)),
    requiredTests: state.requiredTests.map((item) => ({ ...item })),
  };
}

/** Re-read source and migration inventory to reject drift against the private captured bytes. */
export async function verifyWindowsSource(
  snapshot: WindowsSourceSnapshot,
  root: string,
): Promise<void> {
  const state = stateOf(snapshot);
  for (const entry of state.entries) {
    const bytes = await readRegularFile(resolve(root), entry.path);
    const captured = state.files.get(entry.path);
    if (!captured || digest(bytes) !== entry.sha256 || !bytes.equals(captured))
      throw new Error("WINDOWS_SOURCE_DRIFT");
  }
  const migrationDirectory = join(resolve(root), "apps/api/prisma/migrations");
  await assertMigrationReadBounds(migrationDirectory);
  const current = await readMigrationSourceManifest(migrationDirectory);
  if (JSON.stringify(current) !== JSON.stringify(state.migration))
    throw new Error("WINDOWS_MIGRATION_DRIFT");
  state.checks += 1;
}

/** Materialize captured bytes only into a new, exclusive, empty destination. */
export async function snapshotWindowsSource(
  snapshot: WindowsSourceSnapshot,
  destination: string,
): Promise<WindowsSourceManifest> {
  const state = stateOf(snapshot);
  const target = resolve(destination);
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  for (const [path, bytes] of state.files) {
    const output = join(target, ...path.split("/"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes, { flag: "wx", mode: 0o444 });
    if (!bytes.equals(await readFile(output)))
      throw new Error("WINDOWS_SNAPSHOT_COPY_MISMATCH");
  }
  return windowsSourceManifest(snapshot);
}

export interface WindowsProcessReceipt {
  status: "PASS" | "FAIL" | "TIMEOUT" | "SIGNAL" | "SPAWN_FAILED";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  spawnError: string | null;
  stdoutBytes: number;
  stderrBytes: number;
}
export type WindowsProcessLauncher = (
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    windowsHide: true;
  },
) => ChildProcess;
const defaultLauncher: WindowsProcessLauncher = (executable, args, options) =>
  spawn(executable, [...args], options);

/** Execute one fixed-path child with bounded time/output; never include captured output in its receipt. */
export function executeWindowsChild(options: {
  executable: string;
  args: readonly string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBuffer: number;
  launcher?: WindowsProcessLauncher;
}): Promise<WindowsProcessReceipt> {
  if (
    !(
      win32.isAbsolute(options.executable) ||
      resolve(options.executable) === options.executable
    ) ||
    /[\r\n\0]/.test(options.executable) ||
    !Array.isArray(options.args) ||
    options.args.some((arg) => typeof arg !== "string" || /\0/.test(arg)) ||
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 15 * 60_000 ||
    !Number.isInteger(options.maxBuffer) ||
    options.maxBuffer < 1 ||
    options.maxBuffer > 64 * 1024 * 1024 ||
    Object.keys(options.environment).some(
      (key) =>
        forbiddenEnvironmentKey.test(key) ||
        ![
          "path",
          "systemroot",
          "windir",
          "temp",
          "tmp",
          "userprofile",
        ].includes(key.toLowerCase()),
    )
  )
    throw new Error("WINDOWS_CHILD_OPTIONS_INVALID");
  return new Promise((resolveReceipt) => {
    let child: ChildProcess;
    let timedOut = false;
    let overflow = false;
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let spawnError: string | null = null;
    let deadline: NodeJS.Timeout | undefined;
    let killGrace: NodeJS.Timeout | undefined;
    let finalGrace: NodeJS.Timeout | undefined;
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      deadline = undefined;
      clearTimeout(killGrace);
      clearTimeout(finalGrace);
      const status = timedOut
        ? "TIMEOUT"
        : spawnError
          ? "SPAWN_FAILED"
          : overflow
            ? "FAIL"
            : exitCode === 0 && signal === null
              ? "PASS"
              : signal
                ? "SIGNAL"
                : "FAIL";
      resolveReceipt({
        status,
        exitCode,
        signal,
        timedOut,
        spawnError,
        stdoutBytes,
        stderrBytes,
      });
    };
    const terminateBounded = () => {
      child.kill();
      killGrace = setTimeout(() => {
        child.kill("SIGKILL");
        finalGrace = setTimeout(() => finish(null, null), 1_000);
      }, 1_000);
    };
    try {
      child = (options.launcher ?? defaultLauncher)(
        options.executable,
        options.args,
        {
          cwd: options.cwd,
          env: options.environment,
          shell: false,
          windowsHide: true,
        },
      );
    } catch {
      spawnError = "spawn_failed";
      finish(null, null);
      return;
    }
    const count = (kind: "stdout" | "stderr") => (chunk: Buffer | string) => {
      const bytes = Buffer.byteLength(chunk);
      if (kind === "stdout") stdoutBytes += bytes;
      else stderrBytes += bytes;
      if (stdoutBytes + stderrBytes > options.maxBuffer && !overflow) {
        overflow = true;
        terminateBounded();
      }
    };
    child.stdout?.on("data", count("stdout"));
    child.stderr?.on("data", count("stderr"));
    deadline = setTimeout(() => {
      timedOut = true;
      terminateBounded();
    }, options.timeoutMs);
    child.once("error", (error) => {
      spawnError =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "not_found"
          : "spawn_failed";
    });
    child.once("close", (exitCode, signal) => finish(exitCode, signal));
  });
}

export interface WindowsStageReceipt {
  stage: string;
  status: "PASS" | "FAIL" | "SKIP" | "NOT_RUN";
  process: WindowsProcessReceipt | null;
}
export interface WindowsTestResult {
  id: string;
  status: "PASS" | "FAIL" | "SKIP" | "NOT_RUN";
}
export interface WindowsSourceReceipt {
  sourceSha256: string;
  migrationSha256: string;
  requiredTestIds: string[];
  discoveredTestIds: string[];
  testResults: WindowsTestResult[];
  requiredStages: string[];
  stages: WindowsStageReceipt[];
  cleanup: "COMPLETE" | "INCOMPLETE" | "NOT_APPLICABLE";
  state: "PASS" | "FAIL" | "INCOMPLETE";
}

/** PASS requires exact independent test/stage inventories, executed test outcomes, successful processes, and complete cleanup. */
export function createWindowsSourceReceipt(
  snapshot: WindowsSourceSnapshot,
  stages: readonly WindowsStageReceipt[],
  cleanup: WindowsSourceReceipt["cleanup"],
  discoveredTestIds: readonly string[],
  testResults: readonly WindowsTestResult[],
  requiredStages: readonly string[],
): WindowsSourceReceipt {
  const state = stateOf(snapshot);
  const requiredTestIds = state.requiredTests.map((item) => item.id);
  const discovered = [...discoveredTestIds].sort();
  const results = [...testResults].sort((a, b) => a.id.localeCompare(b.id));
  const requiredStageNames = [...requiredStages].sort();
  const uniqueStages = new Set(stages.map((stage) => stage.stage));
  const actualStages = [...uniqueStages].sort();
  const processOk = (process: WindowsProcessReceipt | null) =>
    Boolean(
      process &&
      process.status === "PASS" &&
      process.exitCode === 0 &&
      process.signal === null &&
      !process.timedOut &&
      process.spawnError === null,
    );
  const stagesMatch =
    requiredStageNames.length > 0 &&
    new Set(requiredStageNames).size === requiredStageNames.length &&
    stages.length === uniqueStages.size &&
    JSON.stringify(requiredStageNames) === JSON.stringify(actualStages) &&
    stages.every(
      (stage) => stage.status === "PASS" && processOk(stage.process),
    );
  const testsMatch =
    discovered.length === requiredTestIds.length &&
    new Set(discovered).size === discovered.length &&
    JSON.stringify(discovered) === JSON.stringify([...requiredTestIds].sort());
  const resultsMatch =
    results.length === requiredTestIds.length &&
    new Set(results.map((result) => result.id)).size === results.length &&
    JSON.stringify(results.map((result) => result.id)) ===
      JSON.stringify([...requiredTestIds].sort()) &&
    results.every((result) => result.status === "PASS");
  const testStage = stages.find((stage) => stage.stage === "tests");
  const ok =
    state.checks >= 2 &&
    stagesMatch &&
    testsMatch &&
    resultsMatch &&
    Boolean(testStage && processOk(testStage.process)) &&
    cleanup === "COMPLETE";
  return {
    sourceSha256: state.sha256,
    migrationSha256: digest(JSON.stringify(state.migration)),
    requiredTestIds,
    discoveredTestIds: discovered,
    testResults: results,
    requiredStages: requiredStageNames,
    stages: stages.map((stage) => ({
      ...stage,
      process: stage.process ? { ...stage.process } : null,
    })),
    cleanup,
    state: ok
      ? "PASS"
      : stages.some((stage) => stage.status === "FAIL") ||
          results.some((result) => result.status === "FAIL") ||
          cleanup === "INCOMPLETE"
        ? "FAIL"
        : "INCOMPLETE",
  };
}

export function assertWindowsSourcePass(receipt: WindowsSourceReceipt): void {
  const processOk = (process: WindowsProcessReceipt | null) =>
    Boolean(
      process &&
      process.status === "PASS" &&
      process.exitCode === 0 &&
      process.signal === null &&
      !process.timedOut &&
      process.spawnError === null,
    );
  const stageNames = receipt.stages.map((stage) => stage.stage);
  if (
    !validHash(receipt.sourceSha256) ||
    !validHash(receipt.migrationSha256) ||
    !receipt.requiredTestIds.length ||
    new Set(receipt.requiredTestIds).size !== receipt.requiredTestIds.length ||
    receipt.requiredTestIds.some((id) => !/^[a-f0-9]{64}$/.test(id)) ||
    new Set(receipt.discoveredTestIds).size !==
      receipt.discoveredTestIds.length ||
    JSON.stringify([...receipt.requiredTestIds].sort()) !==
      JSON.stringify([...receipt.discoveredTestIds].sort()) ||
    JSON.stringify(receipt.testResults.map((result) => result.id).sort()) !==
      JSON.stringify([...receipt.requiredTestIds].sort()) ||
    receipt.testResults.some((result) => result.status !== "PASS") ||
    !receipt.requiredStages.length ||
    new Set(receipt.requiredStages).size !== receipt.requiredStages.length ||
    stageNames.length !== new Set(stageNames).size ||
    JSON.stringify(stageNames.sort()) !==
      JSON.stringify([...receipt.requiredStages].sort()) ||
    !receipt.stages.some((stage) => stage.stage === "tests") ||
    receipt.state !== "PASS" ||
    receipt.cleanup !== "COMPLETE" ||
    receipt.stages.some(
      (stage) => stage.status !== "PASS" || !processOk(stage.process),
    )
  )
    throw new Error("WINDOWS_SOURCE_RECEIPT_INCOMPLETE");
}

export function executeWindowsMigrations(): never {
  throw new Error("WINDOWS_MIGRATION_EXECUTION_UNAVAILABLE");
}
export function executeWindowsSchema(): never {
  throw new Error("WINDOWS_SCHEMA_EXECUTION_UNAVAILABLE");
}
