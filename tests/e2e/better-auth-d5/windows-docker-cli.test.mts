import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  execFileDockerTransport,
  WindowsDockerLease,
  WINDOWS_DOCKER_ENDPOINT,
  type DockerCommandResult,
  type DockerCommandTransport,
  type WindowsResourceOptions,
} from "./windows-resources.mts";
import { createDockerCliFixture } from "./windows-docker-cli.fixture.mts";
import {
  loadWindowsDockerCliApproval,
  verifyWindowsDockerCli,
  windowsDockerCliBinding,
} from "./windows-docker-cli.mts";

const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const owner = "11111111-1111-4111-8111-111111111111";
const daemon = "22222222-2222-4222-8222-222222222222";
const source = "a".repeat(64);
const image = `postgres:16.15-alpine@sha256:${"b".repeat(64)}`;
const resolvedImageId = `sha256:${"e".repeat(64)}`;
const now = 1_000_000;
function sandbox<T>(run: (directory: string) => T | Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "d5-cli-identity-"));
  return Promise.resolve()
    .then(() => run(directory))
    .finally(() => rmSync(directory, { recursive: true, force: true }));
}
const grantPayload = (directory: string) => ({
  operation: "acquire",
  owner,
  operator: "operator",
  endpoint: WINDOWS_DOCKER_ENDPOINT,
  daemonId: daemon,
  image,
  resolvedImageId,
  sourceSha256: source,
  migrationSha256: source,
  journalDirectory: directory,
  commandTimeoutMs: 30000,
  expiresAt: now + 60000,
  maxCommands: 500,
});
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value)!;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}
function options(
  directory: string,
  transport: DockerCommandTransport,
  dockerCli: WindowsResourceOptions["dockerCli"],
  changes: Partial<WindowsResourceOptions> = {},
): WindowsResourceOptions {
  const payload = grantPayload(directory);
  return {
    leaseId: owner,
    journalDirectory: directory,
    environment: {},
    sourceSha256: source,
    migrationSha256: source,
    expectedSourceSha256: source,
    expectedMigrationSha256: source,
    g3c: { contract: "G3-C", digestInput: payload },
    reviewPins: { g3cSha256: hash(canonical(payload)) },
    operator: "operator",
    endpoint: WINDOWS_DOCKER_ENDPOINT,
    daemonId: daemon,
    image,
    resolvedImageId,
    dockerCli,
    transport,
    now: () => now,
    ...changes,
  };
}
const failed: DockerCommandResult = {
  stdout: "",
  stderr: "inert test refusal",
  code: 1,
  signal: null,
  timedOut: false,
};

test("approved capability returns only the exact absolute executable and frozen binding", () =>
  sandbox((directory) => {
    const f = createDockerCliFixture(directory);
    assert.equal(verifyWindowsDockerCli(f.approval), f.executable);
    assert.equal(Object.isFrozen(f.approval), true);
    assert.deepEqual(windowsDockerCliBinding(f.approval), {
      path: f.executable,
      sha256: hash("inert fixture executable; never launched\n"),
      approvalSha256: f.reviewedSha256,
      launchApprovalSha256: f.launchApprovalSha256,
    });
  }));

test("missing approval, wrong hashes, and forged or cloned capabilities fail closed", () =>
  sandbox((directory) => {
    const f = createDockerCliFixture(directory);
    for (const value of [undefined, {} as never, { ...f.approval }])
      assert.throws(
        () => verifyWindowsDockerCli(value),
        /^Error: WINDOWS_DOCKER_CLI_INVALID$/,
      );
    assert.throws(
      () => windowsDockerCliBinding(undefined),
      /WINDOWS_DOCKER_CLI_INVALID/,
    );
    assert.throws(
      () =>
        loadWindowsDockerCliApproval(
          f.approvalPath,
          "0".repeat(64),
          f.launchApprovalSha256,
          join(directory, "source"),
          join(directory, "deployment"),
        ),
      /WINDOWS_DOCKER_CLI_INVALID/,
    );
    assert.throws(
      () =>
        loadWindowsDockerCliApproval(
          f.approvalPath,
          f.reviewedSha256,
          "1".repeat(64),
          join(directory, "source"),
          join(directory, "deployment"),
        ),
      /WINDOWS_DOCKER_CLI_INVALID/,
    );
    assert.throws(
      () =>
        loadWindowsDockerCliApproval(
          "relative\\cli.json",
          f.reviewedSha256,
          f.launchApprovalSha256,
          join(directory, "source"),
          join(directory, "deployment"),
        ),
      /WINDOWS_DOCKER_CLI_INVALID/,
    );
    assert.throws(
      () =>
        loadWindowsDockerCliApproval(
          join(directory, "missing.json"),
          f.reviewedSha256,
          f.launchApprovalSha256,
          join(directory, "source"),
          join(directory, "deployment"),
        ),
      /WINDOWS_DOCKER_CLI_INVALID/,
    );
  }));

test("executable bytes changing after observation invalidate identity", () =>
  sandbox((directory) => {
    const f = createDockerCliFixture(directory);
    appendFileSync(f.executable, "changed");
    assert.throws(
      () => verifyWindowsDockerCli(f.approval),
      /WINDOWS_DOCKER_CLI_INVALID/,
    );
  }));

test("sidecar mutation, extra keys, wrong version, and candidate-root substitution fail closed", () =>
  sandbox((directory) => {
    const f = createDockerCliFixture(directory);
    const original = JSON.stringify({
      contract: "D5-WINDOWS-DOCKER-CLI-v1",
      launchApprovalSha256: f.launchApprovalSha256,
      executable: f.executable,
      executableSha256: hash("inert fixture executable; never launched\n"),
    });
    const invalid = [
      {
        contract: "D5-WINDOWS-DOCKER-CLI-v2",
        launchApprovalSha256: f.launchApprovalSha256,
        executable: f.executable,
        executableSha256: hash("x"),
      },
      {
        contract: "D5-WINDOWS-DOCKER-CLI-v1",
        launchApprovalSha256: f.launchApprovalSha256,
        executable: f.executable,
        executableSha256: hash("x"),
        extra: true,
      },
      {
        contract: "D5-WINDOWS-DOCKER-CLI-v1",
        launchApprovalSha256: f.launchApprovalSha256,
        executable: f.executable,
        executableSha256: hash("different inert bytes"),
      },
      {
        contract: "D5-WINDOWS-DOCKER-CLI-v1",
        launchApprovalSha256: f.launchApprovalSha256,
        executable: join(directory, "missing.exe"),
        executableSha256: hash("x"),
      },
    ];
    for (const record of invalid) {
      const bytes = JSON.stringify(record)!;
      writeFileSync(f.approvalPath, bytes);
      assert.throws(
        () => verifyWindowsDockerCli(f.approval),
        /WINDOWS_DOCKER_CLI_INVALID/,
      );
      assert.throws(
        () =>
          loadWindowsDockerCliApproval(
            f.approvalPath,
            hash(bytes),
            f.launchApprovalSha256,
            join(directory, "source"),
            join(directory, "deployment"),
          ),
        /WINDOWS_DOCKER_CLI_INVALID/,
      );
      writeFileSync(f.approvalPath, original);
    }
    assert.throws(
      () =>
        loadWindowsDockerCliApproval(
          f.approvalPath,
          f.reviewedSha256,
          f.launchApprovalSha256,
          directory,
          join(directory, "deployment"),
        ),
      /WINDOWS_DOCKER_CLI_INVALID/,
    );
  }));

test("missing fields and ambiguous executable paths are rejected", () =>
  sandbox((directory) => {
    const f = createDockerCliFixture(directory);
    const invalid: unknown[] = [
      {
        contract: "D5-WINDOWS-DOCKER-CLI-v1",
        launchApprovalSha256: f.launchApprovalSha256,
        executable: f.executable,
      },
      {
        contract: "D5-WINDOWS-DOCKER-CLI-v1",
        launchApprovalSha256: f.launchApprovalSha256,
        executableSha256: hash("x"),
      },
      ...[
        "relative.exe",
        "C:\\folder\\..\\docker.exe",
        "C:\\folder.\\docker.exe",
        "C:\\folder\\docker.exe:stream",
      ].map((executable) => ({
        contract: "D5-WINDOWS-DOCKER-CLI-v1",
        launchApprovalSha256: f.launchApprovalSha256,
        executable,
        executableSha256: hash("x"),
      })),
    ];
    for (const record of invalid) {
      const bytes = JSON.stringify(record)!;
      writeFileSync(f.approvalPath, bytes);
      assert.throws(
        () =>
          loadWindowsDockerCliApproval(
            f.approvalPath,
            hash(bytes),
            f.launchApprovalSha256,
            join(directory, "source"),
            join(directory, "deployment"),
          ),
        /WINDOWS_DOCKER_CLI_INVALID/,
      );
    }
  }));

test("redirected executable paths are rejected", () =>
  sandbox((directory) => {
    const f = createDockerCliFixture(directory);
    const aliasDirectory = join(directory, "redirected-directory");
    symlinkSync(dirname(f.executable), aliasDirectory, "junction");
    const alias = join(aliasDirectory, "fixture-cli.exe");
    const content = JSON.stringify({
      contract: "D5-WINDOWS-DOCKER-CLI-v1",
      launchApprovalSha256: f.launchApprovalSha256,
      executable: alias,
      executableSha256: hash("inert fixture executable; never launched\n"),
    });
    writeFileSync(f.approvalPath, content);
    assert.throws(
      () =>
        loadWindowsDockerCliApproval(
          f.approvalPath,
          hash(content),
          f.launchApprovalSha256,
          join(directory, "source"),
          join(directory, "deployment"),
        ),
      /WINDOWS_DOCKER_CLI_INVALID/,
    );
  }));

test("PATH and PATHEXT shadows cannot change identity and missing adapter identity blocks acquisition", () =>
  sandbox(async (directory) => {
    const f = createDockerCliFixture(directory);
    const shadow = join(directory, "shadow");
    mkdirSync(shadow);
    writeFileSync(join(shadow, "docker.exe"), "not the approved executable");
    const previousPath = process.env.PATH,
      previousExt = process.env.PATHEXT;
    try {
      process.env.PATH = shadow;
      process.env.PATHEXT = ".COM;.EXE";
      assert.equal(verifyWindowsDockerCli(f.approval), f.executable);
      let calls = 0;
      const transport: DockerCommandTransport = async () => {
        calls++;
        return failed;
      };
      await assert.rejects(
        WindowsDockerLease.acquire(options(directory, transport, undefined)),
      );
      assert.equal(calls, 0);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousExt === undefined) delete process.env.PATHEXT;
      else process.env.PATHEXT = previousExt;
    }
  }));

test("adapter raw dispatch receives only the approved absolute executable", () =>
  sandbox(async (directory) => {
    const f = createDockerCliFixture(directory);
    const captured: string[] = [];
    const transport: DockerCommandTransport = async (executable, argv) => {
      captured.push(executable);
      const args = argv.slice(2);
      if (args[0] === "info") return { ...failed, stdout: daemon, code: 0 };
      if (args[0] === "ps" || args[1] === "ls")
        return { ...failed, stdout: "[]", code: 0 };
      if (args[0] === "image")
        return {
          ...failed,
          stdout: JSON.stringify([{ Id: resolvedImageId }]),
          code: 0,
        };
      return failed;
    };
    const lease = await WindowsDockerLease.acquire(
      options(directory, transport, f.approval),
    );
    try {
      assert.ok(captured.length > 0);
      assert.ok(
        captured.every(
          (executable) =>
            executable === f.executable && /^[A-Za-z]:\\/.test(executable),
        ),
      );
    } finally {
      await lease.closeSupervisor();
    }
  }));

test("adapter sends the approved absolute executable and a gate-time byte change blocks transport", () =>
  sandbox(async (directory) => {
    const f = createDockerCliFixture(directory);
    const captured: string[] = [];
    const transport: DockerCommandTransport = async (executable) => {
      captured.push(executable);
      return failed;
    };
    let changed = false;
    const lease = await WindowsDockerLease.acquire(
      options(directory, transport, f.approval, {
        beforeDispatch: {
          check: async () => {
            if (!changed) {
              changed = true;
              appendFileSync(f.executable, "gate-change");
            }
          },
          assertTime() {},
        },
      }),
    );
    try {
      assert.equal(captured.length, 0);
      assert.equal(
        lease.lease.failures.at(-1)?.code,
        "DOCKER_TRANSPORT_UNCERTAIN",
      );
      assert.ok(lease.lease.failureCount > 0);
    } finally {
      await lease.closeSupervisor();
    }
  }));

test("missing identity refuses cleanup recovery before another dispatch", () =>
  sandbox(async (directory) => {
    const f = createDockerCliFixture(directory);
    let calls = 0;
    const transport: DockerCommandTransport = async () => {
      calls++;
      return failed;
    };
    const lease = await WindowsDockerLease.acquire(
      options(directory, transport, f.approval),
    );
    const checkpoint = await lease.closeSupervisor();
    const priorCalls = calls;
    const recovery = options(directory, transport, f.approval);
    await assert.rejects(
      WindowsDockerLease.recoverCleanup(
        { ...recovery, dockerCli: undefined },
        checkpoint,
      ),
    );
    assert.equal(calls, priorCalls);
  }));

test("real transport runs only the approved Node executable with shell disabled and refuses a different path", () =>
  sandbox(async (directory) => {
    const f = createDockerCliFixture(directory, process.execPath);
    const shadow = join(directory, "shadow");
    mkdirSync(shadow);
    const dockerShadow = join(shadow, "docker.exe");
    writeFileSync(dockerShadow, "never execute");
    const marker = join(directory, "node-ran.txt");
    const commandOptions = {
      environment: {
        SystemRoot: process.env.SystemRoot,
        PATH: shadow,
        PATHEXT: ".EXE",
      },
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      dockerCli: f.approval,
    };
    await execFileDockerTransport(
      f.executable,
      [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], 'node-only')",
        marker,
      ],
      commandOptions,
    );
    assert.equal(readFileSync(marker, "utf8"), "node-only");
    assert.throws(
      () => execFileDockerTransport("docker", ["version"], commandOptions),
      /WINDOWS_DOCKER_CLI_EXECUTABLE_MISMATCH/,
    );
    assert.equal(existsSync(dockerShadow), true);
  }));
