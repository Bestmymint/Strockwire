import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  INDEPENDENT_WINDOWS_BOOTSTRAP_PIN,
  validateWindowsBootstrapDeployment,
  type WindowsBootstrapObservation,
} from "./windows-launch.mts";
import {
  assertWindowsBootstrapLeaseScope,
  closeWindowsResourceSupervisor,
  invokeWindowsResourceOperation,
  parseWindowsResourceRequest,
} from "./windows-resource-invocation.mts";
import { WINDOWS_DOCKER_ENDPOINT, type Lease } from "./windows-resources.mts";
import { digest } from "./source-contract.mts";

const request = {
  operation: "acquire",
  leaseId: "11111111-1111-4111-8111-111111111111",
  journalDirectory: "D:\\reviewed\\journal",
  operator: "operator",
  endpoint: WINDOWS_DOCKER_ENDPOINT,
  daemonId: "daemon-id",
  image: `postgres:16.15-alpine@sha256:${"a".repeat(64)}`,
  resolvedImageId: `sha256:${"b".repeat(64)}`,
  files: [],
  requiredTests: [],
};
const bytes = (value: unknown) => JSON.stringify(value);
const deployment: WindowsBootstrapObservation = {
  root: "C:\\Trusted\\D5",
  nodeExecutable: "C:\\Trusted\\Node\\node.exe",
  nodeExecutableSha256: "a".repeat(64),
  workingDirectory: "C:\\Trusted\\D5",
  entryModule: "windows-resource-invocation.mts",
  invocationMode: "file",
  execArgv: [],
  closure: [
    {
      path: "windows-resource-invocation.mts",
      sha256: "b".repeat(64),
      imports: [],
    },
  ],
};

test("resource invocation rejects a request whose independently reviewed byte pin differs", () => {
  assert.throws(
    () => parseWindowsResourceRequest(bytes(request), "0".repeat(64)),
    /REVIEWED_RESOURCE_REQUEST_REQUIRED/,
  );
});

test("resource request cannot supply its own approval or deployment pin", () => {
  for (const extra of [
    { approval: { grant: {}, sha256: "a".repeat(64) } },
    { deploymentPin: {} },
    { beforeDispatch: { kind: "KNOWN_NOT_DISPATCHED" } },
    { dispatchOutcome: { kind: "KNOWN_NOT_DISPATCHED" } },
  ]) {
    const substituted = bytes({ ...request, ...extra });
    assert.throws(
      () => parseWindowsResourceRequest(substituted, digest(substituted)),
      /WINDOWS_RESOURCE_REQUEST_INVALID/,
    );
  }
});

test("resource request rejects extra configuration and malformed source or required-test rows", () => {
  for (const substituted of [
    { ...request, cleanup: true },
    {
      ...request,
      files: [{ path: "package.json", sha256: "a".repeat(64), trusted: true }],
    },
    {
      ...request,
      requiredTests: [
        { file: "safe.test.mts", id: "b".repeat(64), discovered: true },
      ],
    },
  ]) {
    const body = bytes(substituted);
    assert.throws(
      () => parseWindowsResourceRequest(body, digest(body)),
      /WINDOWS_RESOURCE_REQUEST_INVALID/,
    );
  }
});

test("default independent deployment pin is null and refuses a caller-constructed observation", () => {
  assert.equal(INDEPENDENT_WINDOWS_BOOTSTRAP_PIN, null);
  assert.throws(
    () =>
      validateWindowsBootstrapDeployment(
        INDEPENDENT_WINDOWS_BOOTSTRAP_PIN,
        deployment,
        resolve(tmpdir()),
      ),
    /INDEPENDENT_WINDOWS_BOOTSTRAP_PIN_REQUIRED/,
  );
});

test("deployment observation derives Node, cwd and closure hashes from the running process and files", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "d5-observation-"));
  const deployed = resolve(root, "deployed");
  const candidate = resolve(root, "candidate");
  await mkdir(deployed);
  await mkdir(candidate);
  const files = [
    "windows-resource-invocation.mts",
    "windows-launch.mts",
    "windows-source.mts",
    "windows-resources.mts",
    "windows-lease-journal.mts",
    "windows-command-dispatch.mts",
    "windows-docker-cli.mts",
    "migration-contract.mts",
    "source-contract.mts",
  ];
  try {
    for (const file of files)
      await copyFile(
        resolve(dirname(fileURLToPath(import.meta.url)), file),
        resolve(deployed, file),
      );
    const child = `import {readFile} from "node:fs/promises";
import {observeWindowsResourceDeployment} from "./windows-resource-invocation.mts";
const pin=JSON.parse(await readFile(new URL("./pin.json",import.meta.url),"utf8"));
const observed=await observeWindowsResourceDeployment(${JSON.stringify(candidate)},pin);
let overlapRefused=false;
try{await observeWindowsResourceDeployment(${JSON.stringify(deployed)},pin);}
catch(error){overlapRefused=error.message==="WINDOWS_BOOTSTRAP_CANDIDATE_ROOT_OVERLAP";}
console.log(JSON.stringify({observed,overlapRefused}));`;
    await writeFile(resolve(deployed, "entry.mts"), child);
    const pin: WindowsBootstrapObservation = {
      ...deployment,
      root: deployed,
      nodeExecutable: process.execPath,
      workingDirectory: deployed,
      entryModule: "entry.mts",
      closure: await Promise.all(
        [...files, "entry.mts"].map(async (path) => ({
          path,
          sha256: digest(await readFile(resolve(deployed, path))),
          imports: [],
        })),
      ),
    };
    await writeFile(resolve(deployed, "pin.json"), JSON.stringify(pin));
    const environment: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "USERPROFILE",
    ])
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    const result = await promisify(execFile)(
      process.execPath,
      [resolve(deployed, "entry.mts")],
      {
        cwd: deployed,
        env: environment,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const { observed, overlapRefused } = JSON.parse(result.stdout) as {
      observed: WindowsBootstrapObservation;
      overlapRefused: boolean;
    };
    assert.equal(overlapRefused, true);
    assert.deepEqual(observed.execArgv, []);
    assert.equal(observed.nodeExecutable, resolve(process.execPath));
    assert.equal(observed.workingDirectory, deployed);
    assert.equal(
      observed.nodeExecutableSha256,
      digest(await readFile(process.execPath)),
    );
    assert.deepEqual(observed.closure, pin.closure);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrap approval must bind the acquired run and every resource identity", async () => {
  const lease: Lease = {
    owner: request.leaseId,
    token: "22222222-2222-4222-8222-222222222222",
    runId: "33333333-3333-4333-8333-333333333333",
    journalDirectory: request.journalDirectory,
    containerName: "sw-d5-lease-pg",
    networkName: "sw-d5-lease-net",
    volumeName: "sw-d5-lease-data",
    containerId: "c".repeat(64),
    networkId: "d".repeat(64),
    volumeBirth: "2026-10-17T00:00:00Z",
    status: "ACQUIRED",
    failureCount: 0,
    failures: [],
    verdict: "INCOMPLETE",
  };
  const payload = {
    operation: "bootstrap",
    owner: lease.owner,
    runId: lease.runId,
    journalDirectory: lease.journalDirectory,
    resources: {
      token: lease.token,
      containerId: lease.containerId,
      containerName: lease.containerName,
      networkId: lease.networkId,
      networkName: lease.networkName,
      volumeName: lease.volumeName,
      volumeBirth: lease.volumeBirth,
    },
  };
  assert.doesNotThrow(() => assertWindowsBootstrapLeaseScope(payload, lease));
  assert.throws(
    () =>
      assertWindowsBootstrapLeaseScope(
        { ...payload, runId: "44444444-4444-4444-8444-444444444444" },
        lease,
      ),
    /WINDOWS_BOOTSTRAP_RUN_OR_RESOURCE_SCOPE_MISMATCH/,
  );
  assert.throws(
    () =>
      assertWindowsBootstrapLeaseScope(
        {
          ...payload,
          resources: { ...payload.resources, volumeBirth: "replaced" },
        },
        lease,
      ),
    /WINDOWS_BOOTSTRAP_RUN_OR_RESOURCE_SCOPE_MISMATCH/,
  );
  await assert.rejects(
    closeWindowsResourceSupervisor({ lease }),
    /WINDOWS_ACQUIRED_LEASE_HANDLE_REQUIRED/,
  );
});

test("resource operation rejects inherited database, provider and shell overrides before work", async () => {
  const body = bytes(request);
  for (const key of [
    "COMPOSER_NO_INTERACTION",
    "NINEARM_API_KEY",
    "OPENROUTER_API_KEY",
    "DATABASE_URL",
    "PGHOST",
    "DOCKER_HOST",
  ]) {
    const original = process.env[key];
    process.env[key] = "test-only-invalid";
    try {
      await assert.rejects(
        invokeWindowsResourceOperation({
          root: resolve("."),
          requestBytes: body,
          requestSha256: digest(body),
          dockerCli: undefined,
          approval: {
            grant: { contract: "G3-C", digestInput: {} },
            sha256: "0".repeat(64),
          },
        }),
        /WINDOWS_CALLER_ENVIRONMENT_UNSAFE/,
      );
    } finally {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  }
});
