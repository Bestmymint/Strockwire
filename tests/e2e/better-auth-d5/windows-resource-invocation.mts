import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INDEPENDENT_WINDOWS_BOOTSTRAP_PIN,
  validateWindowsBootstrapDeployment,
  validateWindowsNodeLaunch,
  type BootstrapClosureFile,
  type WindowsBootstrapObservation,
  type WindowsBootstrapPin,
} from "./windows-launch.mts";
import { digest } from "./source-contract.mts";
import {
  captureWindowsSource,
  validateWindowsEnvironment,
  verifyWindowsSource,
  windowsSourceManifest,
} from "./windows-source.mts";
import {
  WINDOWS_DOCKER_ENDPOINT,
  type Lease,
  WindowsDockerLease,
  type OperatorGrant,
} from "./windows-resources.mts";
import type { JournalCheckpoint } from "./windows-lease-journal.mts";
import {
  verifyWindowsDockerCli,
  windowsDockerCliBinding,
  type ApprovedWindowsDockerCli,
} from "./windows-docker-cli.mts";

const entryFile = fileURLToPath(import.meta.url);
const entryRoot = dirname(entryFile);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export type WindowsResourceRequest = Readonly<{
  operation: "acquire" | "bootstrap";
  leaseId: string;
  journalDirectory: string;
  operator: string;
  endpoint: typeof WINDOWS_DOCKER_ENDPOINT;
  daemonId: string;
  image: string;
  resolvedImageId: string;
  files: readonly Readonly<{ path: string; sha256: string }>[];
  requiredTests: readonly Readonly<{ file: string; id: string }>[];
}>;
export type WindowsResourceApproval = Readonly<{
  grant: OperatorGrant;
  sha256: string;
}>;
export type WindowsAcquiredResourceHandle = Readonly<{ lease: Lease }>;
const acquiredLeases = new WeakMap<
  WindowsAcquiredResourceHandle,
  {
    lease: WindowsDockerLease;
    configuration: string;
  }
>();
export type WindowsResourceInvocation = Readonly<{
  root: string;
  requestBytes: string;
  requestSha256: string;
  approval: WindowsResourceApproval;
  deploymentPin?: WindowsBootstrapPin | null;
  dockerCli: ApprovedWindowsDockerCli | undefined;
  acquiredLease?: WindowsAcquiredResourceHandle;
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("WINDOWS_RESOURCE_REQUEST_INVALID");
  return value as Record<string, unknown>;
}
export function parseWindowsResourceRequest(
  bytes: string,
  expectedHash: string,
): WindowsResourceRequest {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || digest(bytes) !== expectedHash)
    throw new Error("REVIEWED_RESOURCE_REQUEST_REQUIRED");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    throw new Error("WINDOWS_RESOURCE_REQUEST_INVALID");
  }
  const value = record(parsed);
  const fields =
    "daemonId,endpoint,files,image,journalDirectory,leaseId,operation,operator,requiredTests,resolvedImageId";
  if (
    Object.keys(value).sort().join(",") !== fields ||
    (value.operation !== "acquire" && value.operation !== "bootstrap") ||
    typeof value.leaseId !== "string" ||
    typeof value.journalDirectory !== "string" ||
    typeof value.operator !== "string" ||
    value.endpoint !== WINDOWS_DOCKER_ENDPOINT ||
    typeof value.daemonId !== "string" ||
    typeof value.image !== "string" ||
    typeof value.resolvedImageId !== "string" ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.requiredTests)
  )
    throw new Error("WINDOWS_RESOURCE_REQUEST_INVALID");
  for (const item of value.files) {
    const row = record(item);
    if (
      Object.keys(row).sort().join(",") !== "path,sha256" ||
      typeof row.path !== "string" ||
      typeof row.sha256 !== "string"
    )
      throw new Error("WINDOWS_RESOURCE_REQUEST_INVALID");
  }
  for (const item of value.requiredTests) {
    const row = record(item);
    if (
      Object.keys(row).sort().join(",") !== "file,id" ||
      typeof row.file !== "string" ||
      typeof row.id !== "string"
    )
      throw new Error("WINDOWS_RESOURCE_REQUEST_INVALID");
  }
  return value as unknown as WindowsResourceRequest;
}

/** Defense-in-depth byte observation of the closure independently parsed BEFORE this process starts. */
export async function observeWindowsResourceDeployment(
  candidateRoot: string,
  pin: WindowsBootstrapPin | null = INDEPENDENT_WINDOWS_BOOTSTRAP_PIN,
): Promise<WindowsBootstrapObservation> {
  if (!pin) throw new Error("INDEPENDENT_WINDOWS_BOOTSTRAP_PIN_REQUIRED");
  validateWindowsNodeLaunch(process.execArgv, "file", process.env);
  if (process.argv.length !== 2 || !process.argv[1])
    throw new Error("WINDOWS_BOOTSTRAP_ENTRY_REQUIRED");
  const root = resolve(entryRoot);
  const candidate = resolve(candidateRoot);
  const outside = (value: string) =>
    isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`);
  if (
    !isAbsolute(candidateRoot) ||
    !outside(relative(candidate, root)) ||
    !outside(relative(root, candidate))
  )
    throw new Error("WINDOWS_BOOTSTRAP_CANDIDATE_ROOT_OVERLAP");
  const closure: BootstrapClosureFile[] = [];
  for (const approved of pin.closure) {
    const absolute = resolve(root, approved.path);
    const local = relative(root, absolute);
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
      throw new Error("WINDOWS_BOOTSTRAP_CLOSURE_ESCAPES_ROOT");
    let current = root;
    for (const part of local.split(sep)) {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("WINDOWS_BOOTSTRAP_FILE_INVALID");
      current = resolve(current, part);
    }
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
      throw new Error("WINDOWS_BOOTSTRAP_FILE_INVALID");
    closure.push({
      path: approved.path,
      sha256: hash(await readFile(absolute)),
      imports: [...approved.imports],
    });
  }
  const entryModule = relative(root, resolve(process.argv[1]))
    .split(sep)
    .join("/");
  if (
    !pin.closure.some((file) => file.path === entryModule) ||
    !pin.closure.some(
      (file) => file.path === relative(root, entryFile).split(sep).join("/"),
    )
  )
    throw new Error("WINDOWS_BOOTSTRAP_INVOCATION_CLOSURE_MISSING");
  return {
    root,
    nodeExecutable: resolve(process.execPath),
    nodeExecutableSha256: hash(await readFile(process.execPath)),
    workingDirectory: resolve(process.cwd()),
    entryModule,
    closure,
    invocationMode: "file",
    execArgv: [...process.execArgv],
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined)
      throw new Error("WINDOWS_RESOURCE_APPROVAL_REQUIRED");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = record(value);
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}
function verifyApproval(
  approval: WindowsResourceApproval,
  operation: "acquire" | "bootstrap",
): void {
  if (
    !approval ||
    !approval.grant ||
    !/^[a-f0-9]{64}$/.test(approval.sha256) ||
    approval.grant.contract !== "G3-C" ||
    approval.grant.digestInput === null ||
    typeof approval.grant.digestInput !== "object" ||
    hash(Buffer.from(canonical(approval.grant.digestInput))) !== approval.sha256
  )
    throw new Error("WINDOWS_RESOURCE_APPROVAL_REQUIRED");
  const payload = record(approval.grant.digestInput);
  const fields =
    operation === "acquire"
      ? "commandTimeoutMs,daemonId,endpoint,expiresAt,image,journalDirectory,maxCommands,migrationSha256,operation,operator,owner,resolvedImageId,sourceSha256"
      : "commandTimeoutMs,daemonId,endpoint,expiresAt,image,journalDirectory,maxCommands,migrationSha256,operation,operator,owner,resolvedImageId,resources,runId,sourceSha256";
  if (
    Object.keys(payload).sort().join(",") !== fields ||
    payload.operation !== operation
  )
    throw new Error("WINDOWS_RESOURCE_APPROVAL_SCOPE_MISMATCH");
}
export function assertWindowsBootstrapLeaseScope(
  payloadValue: unknown,
  lease: Lease,
): void {
  const payload = record(payloadValue);
  const expectedResources = {
    token: lease.token,
    containerId: lease.containerId,
    containerName: lease.containerName,
    networkId: lease.networkId,
    networkName: lease.networkName,
    volumeName: lease.volumeName,
    volumeBirth: lease.volumeBirth,
  };
  if (
    payload.operation !== "bootstrap" ||
    payload.owner !== lease.owner ||
    payload.runId !== lease.runId ||
    payload.journalDirectory !== lease.journalDirectory ||
    canonical(payload.resources) !== canonical(expectedResources)
  )
    throw new Error("WINDOWS_BOOTSTRAP_RUN_OR_RESOURCE_SCOPE_MISMATCH");
}

function validateOriginalInvocationEnvironment(): void {
  validateWindowsEnvironment(process.env);
  validateWindowsNodeLaunch(process.execArgv, "file", process.env);
}
async function verifiedInvocation(input: WindowsResourceInvocation) {
  validateOriginalInvocationEnvironment();
  const request = parseWindowsResourceRequest(
    input.requestBytes,
    input.requestSha256,
  );
  if (!input.root || !isAbsolute(input.root))
    throw new Error("WINDOWS_RESOURCE_ROOT_REQUIRED");
  const root = resolve(input.root);
  const source = await captureWindowsSource(
    root,
    request.files,
    request.requiredTests,
  );
  const manifest = windowsSourceManifest(source);
  await verifyWindowsSource(source, root);
  const pin =
    input.deploymentPin === undefined
      ? INDEPENDENT_WINDOWS_BOOTSTRAP_PIN
      : input.deploymentPin;
  const observed = await observeWindowsResourceDeployment(root, pin);
  validateWindowsBootstrapDeployment(pin, observed, root);
  verifyApproval(input.approval, request.operation);
  return { request, manifest };
}

/** A reviewed invocation supports acquire OR bootstrap, never schema execution or cleanup. */
export async function invokeWindowsResourceOperation(
  requested: WindowsResourceInvocation,
): Promise<
  Readonly<{
    lease?: WindowsAcquiredResourceHandle;
    bootstrap?: Readonly<{
      database: string;
      user: string;
      clusterIdentity: string;
    }>;
  }>
> {
  const { acquiredLease, dockerCli, ...values } = requested;
  const input: WindowsResourceInvocation = {
    ...structuredClone(values),
    dockerCli,
    ...(acquiredLease ? { acquiredLease } : {}),
  };
  const { request, manifest } = await verifiedInvocation(input);
  verifyWindowsDockerCli(input.dockerCli);
  const configurationDigest = digest(
    canonical({
      ...request,
      operation: null,
      dockerCli: windowsDockerCliBinding(input.dockerCli),
    }),
  );
  if (request.operation === "acquire") {
    if (input.acquiredLease)
      throw new Error("WINDOWS_ACQUISITION_HANDLE_UNEXPECTED");
    const lease = await WindowsDockerLease.acquire({
      leaseId: request.leaseId,
      journalDirectory: request.journalDirectory,
      environment: process.env,
      sourceSha256: manifest.sourceSha256,
      migrationSha256: manifest.migrationSha256,
      expectedSourceSha256: manifest.sourceSha256,
      expectedMigrationSha256: manifest.migrationSha256,
      g3c: input.approval.grant,
      reviewPins: { g3cSha256: input.approval.sha256 },
      operator: request.operator,
      endpoint: request.endpoint,
      daemonId: request.daemonId,
      image: request.image,
      resolvedImageId: request.resolvedImageId,
      dockerCli: input.dockerCli,
    });
    const handle = Object.freeze({ lease: lease.lease });
    acquiredLeases.set(handle, { lease, configuration: configurationDigest });
    return Object.freeze({ lease: handle });
  }
  const handle = input.acquiredLease;
  const retained = handle ? acquiredLeases.get(handle) : undefined;
  const lease = retained?.lease;
  if (!handle || !lease)
    throw new Error("WINDOWS_ACQUIRED_LEASE_HANDLE_REQUIRED");
  if (retained?.configuration !== configurationDigest)
    throw new Error("WINDOWS_ACQUIRED_CONFIGURATION_MISMATCH");
  const acquired = handle.lease;
  if (
    acquired.owner !== request.leaseId ||
    acquired.journalDirectory !== resolve(request.journalDirectory)
  )
    throw new Error("WINDOWS_ACQUIRED_LEASE_SCOPE_MISMATCH");
  assertWindowsBootstrapLeaseScope(input.approval.grant.digestInput, acquired);
  const bootstrap = await lease.bootstrap(input.approval.grant, {
    g3cSha256: input.approval.sha256,
  });
  return Object.freeze({ bootstrap });
}

/** Release local supervision only; retain resources for separately approved G3-D recovery. */
export async function closeWindowsResourceSupervisor(
  handle: WindowsAcquiredResourceHandle,
): Promise<JournalCheckpoint> {
  const retained = acquiredLeases.get(handle);
  if (!retained) throw new Error("WINDOWS_ACQUIRED_LEASE_HANDLE_REQUIRED");
  const checkpoint = await retained.lease.closeSupervisor();
  acquiredLeases.delete(handle);
  return checkpoint;
}
