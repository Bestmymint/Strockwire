import { execFile } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import {
  sanitizeWindowsEnvironment,
  validateWindowsEnvironment,
} from "./windows-source.mts";
import {
  LeaseJournal,
  LeaseJournalError,
  type JournalCheckpoint,
  type LeaseFailure,
} from "./windows-lease-journal.mts";
import {
  refuseDockerDispatch,
  type DockerDispatchGate,
} from "./windows-command-dispatch.mts";
import {
  verifyWindowsDockerCli,
  windowsDockerCliBinding,
  type ApprovedWindowsDockerCli,
} from "./windows-docker-cli.mts";

export const WINDOWS_DOCKER_ENDPOINT = "npipe:////./pipe/docker_engine";
const OWNER = "stockwise.d5.owner";
const TOKEN = "stockwise.d5.token";
const ROLE = "stockwise.d5.role";
const ID = /^[a-f0-9]{64}$/;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_OUTPUT = 1024 * 1024;
type Kind = "container" | "network" | "volume";
type Fields = Record<string, unknown>;
export type DockerCommandResult = Readonly<{
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  spawnError?: string | null;
}>;
export type DockerCommandTransport = (
  executable: string,
  args: readonly string[],
  options: Readonly<{
    timeoutMs: number;
    maxOutputBytes: number;
    environment: NodeJS.ProcessEnv;
    dockerCli?: ApprovedWindowsDockerCli | undefined;
    stdin?: string;
    // Generated disposable credentials only; never copied from the invoking environment.
    credentials?: Readonly<{ POSTGRES_PASSWORD?: string; PGPASSWORD?: string }>;
  }>,
) => Promise<DockerCommandResult>;
export type OperatorGrant = Readonly<{
  contract: "G3-C" | "G3-D";
  digestInput: unknown;
}>;
export type WindowsResourceOptions = Readonly<{
  leaseId: string;
  journalDirectory: string;
  environment: NodeJS.ProcessEnv;
  sourceSha256: string;
  migrationSha256: string;
  expectedSourceSha256: string;
  expectedMigrationSha256: string;
  g3c: OperatorGrant | null;
  reviewPins: Readonly<{ g3cSha256: string }>;
  operator: string;
  endpoint: string;
  daemonId: string;
  image: string;
  resolvedImageId: string;
  dockerCli: ApprovedWindowsDockerCli | undefined;
  transport?: DockerCommandTransport;
  beforeDispatch?: DockerDispatchGate;
  now?: () => number;
}>;
export type Lease = Readonly<{
  owner: string;
  token: string;
  runId: string;
  journalDirectory: string;
  containerName: string;
  networkName: string;
  volumeName: string;
  containerId: string | null;
  networkId: string | null;
  volumeBirth: string | null;
  status: "ACQUIRED" | "UNCERTAIN" | "INCOMPLETE" | "CLEAN";
  failureCount: number;
  failures: readonly LeaseFailure[];
  verdict: "PASS" | "FAIL" | "INCOMPLETE";
}>;
type LeaseState = Omit<Lease, "failureCount" | "failures" | "verdict">;
export type CleanupRecoveryOptions = Omit<
  WindowsResourceOptions,
  "g3c" | "reviewPins"
>;
type Resource = {
  kind: Kind;
  name: string;
  identity: string | null;
  confirmed: boolean;
  attempted: boolean;
};
type Inventory = Record<Kind, { id: string; name: string }[]>;
type Budget = { grant: Fields; remaining: number; digest?: string };
class LeaseContractFailure extends Error {
  readonly code: string;
  readonly evidence: Fields;
  constructor(code: string, evidence: Fields) {
    super(code);
    this.code = code;
    this.evidence = structuredClone(evidence);
  }
}
function fail(code: string, evidence: Fields = {}): never {
  throw new LeaseContractFailure(code, evidence);
}
const hash = (value: unknown): value is string =>
  typeof value === "string" && ID.test(value);
function record(value: unknown): Fields {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("DOCKER_RECORD_INVALID");
  return value as Fields;
}
function verifyPostgresImage(
  image: Fields,
  options: WindowsResourceOptions,
): void {
  if (image.Id !== options.resolvedImageId) fail("IMAGE_IDENTITY_MISMATCH");
  const tags = image.RepoTags;
  const digests = image.RepoDigests;
  if (
    image.Os !== "linux" ||
    image.Architecture !== "amd64" ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string") ||
    !Array.isArray(digests) ||
    !digests.every((digest) => typeof digest === "string") ||
    !digests.includes(`postgres@${options.image.split("@")[1]}`)
  )
    fail("POSTGRES_IMAGE_METADATA_MISMATCH");
  const environment = record(image.Config).Env;
  if (
    !Array.isArray(environment) ||
    !environment.every(
      (entry) => typeof entry === "string" && !/[\r\n\0]/.test(entry),
    )
  )
    fail("POSTGRES_IMAGE_METADATA_MISMATCH");
  const major = environment.filter((entry) => entry.startsWith("PG_MAJOR="));
  const version = environment.filter((entry) =>
    entry.startsWith("PG_VERSION="),
  );
  if (
    major.length !== 1 ||
    major[0] !== "PG_MAJOR=16" ||
    version.length !== 1 ||
    !/^PG_VERSION=16\.(?:0|[1-9][0-9]*)$/.test(version[0]!)
  )
    fail("POSTGRES_IMAGE_METADATA_MISMATCH");
  const tag = `postgres:${version[0]!.slice("PG_VERSION=".length)}-alpine`;
  // A digest-only lookup still needs consistent official version/Alpine metadata.
  if (
    !tags.includes(tag) ||
    (options.image.startsWith("postgres:") &&
      options.image.split("@")[0] !== tag)
  )
    fail("POSTGRES_IMAGE_METADATA_MISMATCH");
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return fail("GRANT_VALUE_INVALID");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record(value)[key])}`)
    .join(",")}}`;
}
function grantPayload(
  grant: OperatorGrant | null,
  pin: string,
  contract: "G3-C" | "G3-D",
): Fields {
  if (!grant || grant.contract !== contract || !hash(pin))
    return fail("OPERATOR_AUTHORIZATION_MISSING");
  if (
    createHash("sha256").update(canonical(grant.digestInput)).digest("hex") !==
    pin
  )
    return fail("OPERATOR_AUTHORIZATION_PIN_MISMATCH");
  return record(structuredClone(grant.digestInput));
}

/** No shell, dotenv, inherited PostgreSQL configuration or provider credentials. */
export const execFileDockerTransport: DockerCommandTransport = (
  executable,
  args,
  options,
) => {
  if (verifyWindowsDockerCli(options.dockerCli) !== executable)
    throw new Error("WINDOWS_DOCKER_CLI_EXECUTABLE_MISMATCH");
  const environment = sanitizeWindowsEnvironment(options.environment);
  for (const [key, value] of Object.entries(options.credentials ?? {})) {
    if (
      !["POSTGRES_PASSWORD", "PGPASSWORD"].includes(key) ||
      typeof value !== "string" ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(value)
    )
      return Promise.reject(new Error("DISPOSABLE_CREDENTIAL_INVALID"));
    environment[key] = value;
  }
  return new Promise((resolveResult) => {
    let finished = false;
    let grace: NodeJS.Timeout | undefined;
    const finish = (result: DockerCommandResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(grace);
      clearTimeout(deadline);
      resolveResult(result);
    };
    const child = execFile(
      executable,
      [...args],
      {
        env: environment,
        shell: false,
        windowsHide: true,
        maxBuffer: options.maxOutputBytes,
      },
      (error, stdout, stderr) => {
        const detail = error as
          | (Error & { code?: string | number; signal?: NodeJS.Signals | null })
          | null;
        finish({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          code: error
            ? typeof detail?.code === "number"
              ? detail.code
              : null
            : 0,
          signal: detail?.signal ?? null,
          timedOut: expired,
          spawnError:
            error && typeof detail?.code === "string" ? detail.code : null,
        });
      },
    );
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      child.kill("SIGKILL");
      // A missing close is an unresolved operation, never a fabricated successful exit.
      grace = setTimeout(
        () =>
          finish({
            stdout: "",
            stderr: "",
            code: null,
            signal: null,
            timedOut: true,
          }),
        1000,
      );
    }, options.timeoutMs);
    child.stdin?.on("error", () => {
      /* Process exit/error receipt is authoritative; never echo SQL. */
    });
    child.stdin?.end(options.stdin);
  });
};

export class WindowsDockerLease {
  private busy = false;
  private closed = false;
  private recoveryOnly = false;
  private active: Budget;
  private readonly password = randomBytes(32).toString("base64url");
  private readonly resources: Resource[];
  private bootstrapped = false;
  private readonly options: WindowsResourceOptions;
  private readonly state: LeaseState;
  private readonly journal: LeaseJournal;
  private constructor(
    options: WindowsResourceOptions,
    state: LeaseState,
    journal: LeaseJournal,
    acquisition: Budget,
  ) {
    this.options = options;
    this.state = state;
    this.journal = journal;
    this.active = acquisition;
    this.resources = [
      {
        kind: "volume",
        name: state.volumeName,
        identity: null,
        confirmed: false,
        attempted: false,
      },
      {
        kind: "network",
        name: state.networkName,
        identity: null,
        confirmed: false,
        attempted: false,
      },
      {
        kind: "container",
        name: state.containerName,
        identity: null,
        confirmed: false,
        attempted: false,
      },
    ];
  }
  get lease(): Lease {
    const failures = this.journal.failures;
    return Object.freeze({
      ...this.state,
      failures,
      failureCount: failures.length,
      verdict:
        this.journal.poisoned || failures.length
          ? "FAIL"
          : this.state.status === "CLEAN"
            ? "PASS"
            : "INCOMPLETE",
    });
  }
  private errorCode(error: unknown): string {
    if (
      error instanceof Error &&
      [
        "WINDOWS_CALLER_ENVIRONMENT_UNSAFE",
        "WINDOWS_ENVIRONMENT_ALIAS_CONFLICT",
        "WINDOWS_DOCKER_CLI_INVALID",
        "WINDOWS_DOCKER_CLI_EXECUTABLE_MISMATCH",
      ].includes(error.message)
    )
      return error.message;
    return error instanceof LeaseContractFailure ||
      error instanceof LeaseJournalError
      ? error.code
      : "CLEANUP_UNEXPECTED_FAILURE";
  }
  private async retainFailure(
    category: LeaseFailure["category"],
    code: string,
    evidence: Fields = {},
  ): Promise<void> {
    await this.journal.failure(category, code, {
      ...evidence,
      containerId: this.state.containerId,
      networkId: this.state.networkId,
      volumeBirth: this.state.volumeBirth,
      grantDigest: this.active.digest ?? null,
    });
  }
  private configuration(): Fields {
    return {
      endpoint: this.options.endpoint,
      daemonId: this.options.daemonId,
      sourceSha256: this.options.sourceSha256,
      migrationSha256: this.options.migrationSha256,
      image: this.options.image,
      resolvedImageId: this.options.resolvedImageId,
      journalDirectory: this.options.journalDirectory,
      dockerCli: windowsDockerCliBinding(this.options.dockerCli),
      operatorSha256: createHash("sha256")
        .update(this.options.operator)
        .digest("hex"),
    };
  }
  private enter(): void {
    if (this.busy || this.closed || this.state.status === "CLEAN")
      fail("LEASE_OPERATION_CONFLICT");
    this.busy = true;
  }
  private leave(): void {
    this.busy = false;
  }
  private static budget(
    options: WindowsResourceOptions,
    owner: string,
    grant: Fields,
    operation: string,
    runId?: string,
  ): Budget {
    const now = (options.now ?? Date.now)();
    if (
      grant.operation !== operation ||
      grant.endpoint !== options.endpoint ||
      grant.daemonId !== options.daemonId ||
      grant.owner !== owner ||
      (operation === "cleanup" && grant.runId !== runId) ||
      grant.operator !== options.operator ||
      grant.journalDirectory !== options.journalDirectory ||
      grant.commandTimeoutMs !== 30_000 ||
      grant.sourceSha256 !== options.sourceSha256 ||
      grant.migrationSha256 !== options.migrationSha256 ||
      grant.image !== options.image ||
      grant.resolvedImageId !== options.resolvedImageId ||
      !Number.isSafeInteger(grant.expiresAt) ||
      (grant.expiresAt as number) <= now ||
      (grant.expiresAt as number) > now + 3_600_000 ||
      !Number.isSafeInteger(grant.maxCommands) ||
      (grant.maxCommands as number) < 1 ||
      (grant.maxCommands as number) > 1000
    )
      return fail("OPERATOR_AUTHORIZATION_SCOPE_MISMATCH");
    return { grant, remaining: grant.maxCommands as number };
  }
  private exactResources(grant: Fields): void {
    const expected = {
      token: this.state.token,
      containerId: this.state.containerId,
      containerName: this.state.containerName,
      networkId: this.state.networkId,
      networkName: this.state.networkName,
      volumeName: this.state.volumeName,
      volumeBirth: this.state.volumeBirth,
    };
    if (
      !this.resources.every((resource) => resource.confirmed) ||
      canonical(grant.resources) !== canonical(expected)
    )
      fail("EXACT_RESOURCE_AUTHORIZATION_REQUIRED");
  }
  private static normalize(
    input: WindowsResourceOptions,
  ): WindowsResourceOptions {
    validateWindowsEnvironment(input.environment);
    // A real invocation cannot hide inherited settings behind a pre-scrubbed options object.
    // Injected transports are the database-free test seam, never an approval bypass.
    if (
      input.transport === undefined ||
      input.transport === execFileDockerTransport
    ) {
      validateWindowsEnvironment(process.env);
      if (input.now !== undefined)
        fail("REAL_TRANSPORT_CLOCK_OVERRIDE_REFUSED");
    }
    if (!isAbsolute(input.journalDirectory))
      fail("ABSOLUTE_JOURNAL_DIRECTORY_REQUIRED");
    const options: WindowsResourceOptions = {
      ...input,
      journalDirectory: resolve(input.journalDirectory),
      environment: { ...input.environment },
      g3c: input.g3c ? structuredClone(input.g3c) : null,
      reviewPins: { ...input.reviewPins },
    };
    if (
      !UUID.test(options.leaseId) ||
      !options.operator.trim() ||
      options.endpoint !== WINDOWS_DOCKER_ENDPOINT ||
      !options.daemonId ||
      /[\r\n\0]/.test(options.daemonId) ||
      !/^postgres(?::16\.[0-9]+-alpine)?@sha256:[a-f0-9]{64}$/.test(
        options.image,
      ) ||
      /[\r\n\0]/.test(options.image) ||
      !/^sha256:[a-f0-9]{64}$/.test(options.resolvedImageId) ||
      !hash(options.sourceSha256) ||
      !hash(options.migrationSha256) ||
      options.sourceSha256 !== options.expectedSourceSha256 ||
      options.migrationSha256 !== options.expectedMigrationSha256
    )
      fail("WINDOWS_RESOURCE_CONFIGURATION_INVALID");
    verifyWindowsDockerCli(options.dockerCli);
    return options;
  }
  static async acquire(
    input: WindowsResourceOptions,
  ): Promise<WindowsDockerLease> {
    const options = WindowsDockerLease.normalize(input);
    const payload = grantPayload(
      options.g3c,
      options.reviewPins.g3cSha256,
      "G3-C",
    );
    const stem = `sw-d5-${options.leaseId}`;
    const state: LeaseState = {
      owner: options.leaseId,
      token: randomUUID(),
      runId: randomUUID(),
      journalDirectory: options.journalDirectory,
      containerName: `${stem}-pg`,
      networkName: `${stem}-net`,
      volumeName: `${stem}-data`,
      containerId: null,
      networkId: null,
      volumeBirth: null,
      status: "UNCERTAIN",
    };
    // Validate the grant before acquiring even a local journal/lock.
    const budget = WindowsDockerLease.budget(
      options,
      state.owner,
      payload,
      "acquire",
    );
    const journal = await LeaseJournal.create(
      options.journalDirectory,
      { owner: state.owner, runId: state.runId, token: state.token },
      options.now ?? Date.now,
    );
    const lease = new WindowsDockerLease(options, state, journal, budget);
    await journal.event("LEASE", {
      ...state,
      endpoint: options.endpoint,
      daemonId: options.daemonId,
      sourceSha256: options.sourceSha256,
      migrationSha256: options.migrationSha256,
      configuration: lease.configuration(),
    });
    try {
      const existing = await lease.inventory();
      if (lease.hasResources(existing)) fail("EXISTING_OR_FOREIGN_RESOURCE");
      const image = lease.one(
        await lease.call(["image", "inspect", options.image]),
      );
      verifyPostgresImage(image, options);
      for (const resource of lease.resources) await lease.create(resource);
      await lease.verifyLease(false);
      Object.assign(state, { status: "ACQUIRED" });
    } catch (error) {
      Object.assign(state, {
        status: lease.resources.some(
          (resource) => resource.attempted && !resource.confirmed,
        )
          ? "UNCERTAIN"
          : "INCOMPLETE",
      });
      await journal.event("ACQUISITION_INCOMPLETE", { status: state.status });
      await lease.retainFailure(
        "ACQUISITION",
        lease.errorCode(error),
        error instanceof LeaseContractFailure ? error.evidence : {},
      );
      await lease.reconcileBounded();
    }
    return lease;
  }
  /** Release only the local supervisor, retaining resources and all authority/failure history. */
  async closeSupervisor(): Promise<JournalCheckpoint> {
    this.enter();
    try {
      const checkpoint = await this.journal.close({
        state: { ...this.state },
        resources: structuredClone(this.resources),
        configuration: this.configuration(),
        failureCount: this.journal.failureCount,
      });
      this.closed = true;
      return checkpoint;
    } finally {
      this.leave();
    }
  }
  /** Recovery restores evidence, not creation authority. A separately verified G3-D is still required. */
  static async recoverCleanup(
    input: CleanupRecoveryOptions,
    checkpoint: JournalCheckpoint,
  ): Promise<WindowsDockerLease> {
    const options = WindowsDockerLease.normalize({
      ...input,
      g3c: null,
      reviewPins: { g3cSha256: "" },
    });
    if (checkpoint.owner !== options.leaseId) fail("RECOVERY_LEASE_MISMATCH");
    const journal = await LeaseJournal.recover(
      options.journalDirectory,
      checkpoint,
      options.now ?? Date.now,
    );
    const snapshot = journal.recoveredSnapshot;
    const saved = record(snapshot.state);
    const stem = `sw-d5-${options.leaseId}`;
    function immutableId(value: unknown): value is string | null {
      return value === null || (typeof value === "string" && ID.test(value));
    }
    if (
      saved.owner !== options.leaseId ||
      saved.token !== checkpoint.token ||
      saved.runId !== checkpoint.runId ||
      saved.journalDirectory !== options.journalDirectory ||
      saved.containerName !== `${stem}-pg` ||
      saved.networkName !== `${stem}-net` ||
      saved.volumeName !== `${stem}-data` ||
      !immutableId(saved.containerId) ||
      !immutableId(saved.networkId) ||
      !(
        saved.volumeBirth === null ||
        (typeof saved.volumeBirth === "string" && saved.volumeBirth.length > 0)
      ) ||
      (saved.status !== "ACQUIRED" &&
        saved.status !== "UNCERTAIN" &&
        saved.status !== "INCOMPLETE") ||
      snapshot.failureCount !== journal.failureCount
    )
      fail("RECOVERY_STATE_UNRECONCILED");
    const state: LeaseState = {
      owner: options.leaseId,
      token: checkpoint.token,
      runId: checkpoint.runId,
      journalDirectory: options.journalDirectory,
      containerName: `${stem}-pg`,
      networkName: `${stem}-net`,
      volumeName: `${stem}-data`,
      containerId: saved.containerId,
      networkId: saved.networkId,
      volumeBirth: saved.volumeBirth,
      status: saved.status,
    };
    const lease = new WindowsDockerLease(options, state, journal, {
      grant: { expiresAt: 0 },
      remaining: 0,
    });
    if (
      canonical(snapshot.configuration) !== canonical(lease.configuration()) ||
      canonical(journal.originConfiguration) !==
        canonical(lease.configuration()) ||
      !Array.isArray(snapshot.resources) ||
      snapshot.resources.length !== 3
    )
      fail("RECOVERY_BINDING_MISMATCH");
    const history = journal.acquisitionState;
    for (const resource of lease.resources) {
      const value = record(
        snapshot.resources.find(
          (value) => record(value).kind === resource.kind,
        ),
      );
      const prior = history.find((value) => value.kind === resource.kind) ?? {
        ...resource,
      };
      if (
        canonical(value) !== canonical(prior) ||
        value.name !== resource.name ||
        typeof value.attempted !== "boolean" ||
        typeof value.confirmed !== "boolean" ||
        (value.confirmed &&
          (!value.attempted || typeof value.identity !== "string")) ||
        value.identity !==
          (resource.kind === "container"
            ? state.containerId
            : resource.kind === "network"
              ? state.networkId
              : state.volumeBirth)
      )
        fail("RECOVERY_ACQUISITION_UNRECONCILED");
      Object.assign(resource, value);
    }
    lease.recoveryOnly = true;
    await journal.event("SUPERVISOR_RECOVERED", {
      checkpointSha256: checkpoint.journalSha256,
    });
    for (const interrupted of journal.interruptedReservations)
      await lease.retainFailure("PROCESS", "COMMAND_INTERRUPTED", {
        reservation: interrupted.sequence,
        command: interrupted.command,
        originalGrantDigest: interrupted.digest,
      });
    return lease;
  }
  private async raw(
    args: readonly string[],
    stdin?: string,
    credentials?: { POSTGRES_PASSWORD?: string; PGPASSWORD?: string },
    expectedCodes: readonly number[] = [0],
  ): Promise<DockerCommandResult> {
    if (
      this.options.transport === undefined ||
      this.options.transport === execFileDockerTransport
    )
      validateWindowsEnvironment(process.env);
    if (
      (this.options.now ?? Date.now)() >=
      (this.active.grant.expiresAt as number)
    )
      return fail("OPERATOR_COMMAND_LIMIT_OR_EXPIRY");
    const executable = verifyWindowsDockerCli(this.options.dockerCli);
    let reservation: number | undefined;
    if (this.active.digest) {
      reservation = await this.journal.reserve(
        this.active.digest,
        args[0] ?? "unknown",
        args[0] === "stop" || args[0] === "rm" || args[1] === "rm",
      );
    } else if (this.active.remaining-- <= 0) {
      return fail("OPERATOR_COMMAND_LIMIT_OR_EXPIRY");
    }
    const outcome = await this.journal.dispatchCommand(
      reservation,
      this.options.transport ?? execFileDockerTransport,
      executable,
      ["--host", this.options.endpoint, ...args],
      {
        timeoutMs: 30_000,
        maxOutputBytes: MAX_OUTPUT,
        environment: this.options.environment,
        dockerCli: this.options.dockerCli,
        ...(stdin === undefined ? {} : { stdin }),
        ...(credentials === undefined ? {} : { credentials }),
      },
      this.options.beforeDispatch,
      () => {
        if (
          this.options.transport === undefined ||
          this.options.transport === execFileDockerTransport
        )
          validateWindowsEnvironment(process.env);
        if (verifyWindowsDockerCli(this.options.dockerCli) !== executable)
          throw new Error("WINDOWS_DOCKER_CLI_EXECUTABLE_MISMATCH");
        // The awaited gate may cross the authority deadline after reservation I/O.
        if (
          (this.options.now ?? Date.now)() >=
          (this.active.grant.expiresAt as number)
        )
          refuseDockerDispatch("AUTHORITY_EXPIRED_BEFORE_DISPATCH");
      },
    );
    if (outcome.kind === "KNOWN_NOT_DISPATCHED") {
      const evidence = {
        reason: outcome.reason,
        provenance: outcome.provenance,
      };
      if (reservation !== undefined)
        await this.journal.notDispatched(reservation, outcome);
      else
        await this.journal.event("COMMAND_DISPATCH_REFUSED", {
          command: args[0],
          ...evidence,
        });
      await this.retainFailure(
        outcome.reason === "AUTHORITY_EXPIRED_BEFORE_DISPATCH"
          ? "AUTHORIZATION"
          : "PROCESS",
        "DOCKER_COMMAND_NOT_DISPATCHED",
        {
          command: args[0],
          reservation: reservation ?? null,
          ...evidence,
        },
      );
      fail("DOCKER_COMMAND_NOT_DISPATCHED");
    }
    if (outcome.kind === "UNCERTAIN" && !outcome.result) {
      await this.retainFailure("PROCESS", "DOCKER_TRANSPORT_UNCERTAIN", {
        command: args[0],
        reservation: reservation ?? null,
        provenance: outcome.provenance,
      });
      fail("DOCKER_TRANSPORT_UNCERTAIN");
    }
    const result = outcome.result;
    if (!result) fail("DOCKER_TRANSPORT_UNCERTAIN");
    const receipt = {
      command: args[0],
      exitCode: result.code,
      signal:
        result.signal && /^[A-Z0-9]+$/.test(result.signal)
          ? result.signal
          : null,
      timedOut: result.timedOut,
      spawnError:
        result.spawnError && /^[A-Z0-9_]{1,32}$/.test(result.spawnError)
          ? result.spawnError
          : null,
    };
    if (reservation !== undefined)
      await this.journal.commandResult(
        reservation,
        receipt,
        outcome.kind === "UNCERTAIN",
      );
    await this.journal.event("PROCESS_RESULT", receipt);
    if (
      result.timedOut ||
      result.signal !== null ||
      result.code === null ||
      !expectedCodes.includes(result.code) ||
      result.spawnError
    ) {
      await this.journal.event("PROCESS_FAILURE", receipt);
      await this.retainFailure("PROCESS", "DOCKER_COMMAND_FAILED", receipt);
    }
    return result;
  }
  private async daemon(): Promise<void> {
    const result = await this.raw(["info", "--format", "{{.ID}}"]);
    if (!this.success(result)) fail("DOCKER_COMMAND_FAILED");
    if (result.stdout.trim() !== this.options.daemonId)
      fail("DOCKER_DAEMON_DRIFT", {
        observedSha256: createHash("sha256")
          .update(result.stdout.trim())
          .digest("hex"),
      });
  }
  private success(result: DockerCommandResult): boolean {
    return (
      result.code === 0 &&
      result.signal === null &&
      !result.timedOut &&
      !result.spawnError
    );
  }
  private async call(
    args: readonly string[],
    stdin?: string,
    credentials?: { POSTGRES_PASSWORD?: string; PGPASSWORD?: string },
    response?: (stdout: string) => Promise<void>,
  ): Promise<string> {
    await this.daemon();
    const result = await this.raw(args, stdin, credentials);
    if (!this.success(result)) return fail("DOCKER_COMMAND_FAILED");
    if (response) await response(result.stdout.trim());
    await this.daemon();
    return result.stdout.trim();
  }
  private one(bytes: string): Fields {
    const value: unknown = JSON.parse(bytes);
    if (!Array.isArray(value) || value.length !== 1)
      return fail("DOCKER_INSPECTION_INVALID");
    return record(value[0]);
  }
  private labels(kind: Kind): string[] {
    return [
      "--label",
      `${OWNER}=${this.state.owner}`,
      "--label",
      `${TOKEN}=${this.state.token}`,
      "--label",
      `${ROLE}=${kind}`,
    ];
  }
  private owned(value: Fields, kind: Kind): void {
    const labels = record(
      kind === "container" ? record(value.Config).Labels : value.Labels,
    );
    if (
      labels[OWNER] !== this.state.owner ||
      labels[TOKEN] !== this.state.token ||
      labels[ROLE] !== kind
    )
      fail("RESOURCE_OWNERSHIP_MISMATCH", {
        kind,
        observedSha256: createHash("sha256")
          .update(
            canonical({
              owner: labels[OWNER] ?? null,
              token: labels[TOKEN] ?? null,
              role: labels[ROLE] ?? null,
            }),
          )
          .digest("hex"),
      });
  }
  private async create(resource: Resource): Promise<void> {
    await this.journal.event("CREATE_INTENT", {
      kind: resource.kind,
      name: resource.name,
      token: this.state.token,
    });
    resource.attempted = true;
    const args =
      resource.kind === "volume"
        ? ["volume", "create", ...this.labels("volume"), resource.name]
        : resource.kind === "network"
          ? [
              "network",
              "create",
              "--internal",
              ...this.labels("network"),
              resource.name,
            ]
          : [
              "create",
              "--pull=never",
              "--name",
              resource.name,
              "--network",
              this.state.networkId!,
              "--mount",
              `type=volume,src=${this.state.volumeName},dst=/var/lib/postgresql/data`,
              "--env",
              "POSTGRES_PASSWORD",
              "--cpus=2",
              "--memory=1g",
              "--pids-limit=128",
              "--restart=no",
              ...this.labels("container"),
              this.options.image,
            ];
    await this.call(
      args,
      undefined,
      resource.kind === "container"
        ? { POSTGRES_PASSWORD: this.password }
        : undefined,
      async (output) => {
        if (resource.kind !== "volume") {
          if (!ID.test(output)) fail("IMMUTABLE_CREATE_RESPONSE_MISSING");
          resource.identity = output;
          Object.assign(
            this.state,
            resource.kind === "container"
              ? { containerId: output }
              : { networkId: output },
          );
        } else if (output !== resource.name)
          fail("VOLUME_CREATE_RESPONSE_MISMATCH");
        await this.journal.event("CREATE_RESPONSE", {
          kind: resource.kind,
          name: resource.name,
          identity: resource.identity,
        });
      },
    );
    const value = this.one(
      await this.call([
        resource.kind,
        "inspect",
        resource.identity ?? resource.name,
      ]),
    );
    this.owned(value, resource.kind);
    if (resource.kind === "volume") {
      if (
        value.Name !== resource.name ||
        typeof value.CreatedAt !== "string" ||
        !value.CreatedAt ||
        value.Driver !== "local" ||
        Object.keys(record(value.Options ?? {})).length
      )
        fail("VOLUME_BIRTH_OR_DRIVER_MISMATCH");
      resource.identity = value.CreatedAt;
      Object.assign(this.state, { volumeBirth: resource.identity });
    } else if (
      value.Id !== resource.identity ||
      value.Name !==
        (resource.kind === "container" ? `/${resource.name}` : resource.name)
    )
      fail("RESOURCE_IDENTITY_MISMATCH");
    resource.confirmed = true;
    await this.journal.event("CREATE_CONFIRMED", {
      kind: resource.kind,
      identity: resource.identity,
      name: resource.name,
    });
  }
  private async inventory(): Promise<Inventory> {
    const inventory: Inventory = { container: [], network: [], volume: [] };
    for (const kind of ["container", "network", "volume"] as const) {
      const base =
        kind === "container"
          ? ["ps", "-a", "--no-trunc"]
          : kind === "network"
            ? ["network", "ls", "--no-trunc"]
            : ["volume", "ls"];
      const format =
        kind === "container"
          ? "{{.ID}}|{{.Names}}"
          : kind === "network"
            ? "{{.ID}}|{{.Name}}"
            : "{{.Name}}";
      // Complete identities, owner and token inventories are independent; labels alone never grant adoption/deletion.
      for (const filter of [
        null,
        `${OWNER}=${this.state.owner}`,
        `${TOKEN}=${this.state.token}`,
      ]) {
        const result = await this.call([
          ...base,
          ...(filter ? ["--filter", `label=${filter}`] : []),
          "--format",
          format,
        ]);
        for (const line of result ? result.split(/\r?\n/) : []) {
          const parts = line.split("|");
          const id = parts[0];
          const name = kind === "volume" ? parts[0] : parts[1];
          if (
            !id ||
            !name ||
            (kind !== "volume" && !ID.test(id)) ||
            !/^[a-zA-Z0-9_.-]+$/.test(name) ||
            parts.length !== (kind === "volume" ? 1 : 2)
          )
            fail("DOCKER_INVENTORY_INVALID");
          if (
            filter ||
            this.resources.some(
              (resource) =>
                resource.kind === kind &&
                (resource.name === name || resource.identity === id),
            )
          )
            inventory[kind].push({ id, name });
        }
      }
    }
    return inventory;
  }
  private hasResources(inventory: Inventory): boolean {
    return Object.values(inventory).some((entries) => entries.length !== 0);
  }
  private async reconcileBounded(): Promise<void> {
    for (let observation = 0; observation < 3; observation++) {
      try {
        await this.journal.event("RECONCILIATION", {
          observation,
          inventory: await this.inventory(),
        });
      } catch {
        await this.journal.event("RECONCILIATION_UNKNOWN", { observation });
      }
      if (observation < 2)
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // No finite empty poll establishes a lost Docker create's quiescence. Unconfirmed intents stay unresolved.
  }
  async reconcile(): Promise<Lease> {
    this.enter();
    try {
      if (this.recoveryOnly) fail("CLEANUP_RECOVERY_ONLY");
      await this.reconcileBounded();
      return this.lease;
    } finally {
      this.leave();
    }
  }
  private async inspect(kind: Kind): Promise<Fields> {
    const resource = this.resources.find((item) => item.kind === kind)!;
    if (!resource.confirmed || !resource.identity)
      return fail("UNCONFIRMED_RESOURCE");
    const value = this.one(
      await this.call([
        kind,
        "inspect",
        kind === "volume" ? resource.name : resource.identity,
      ]),
    );
    this.owned(value, kind);
    if (kind === "volume") {
      if (
        value.Name !== resource.name ||
        value.CreatedAt !== resource.identity ||
        value.Driver !== "local" ||
        Object.keys(record(value.Options ?? {})).length
      )
        fail("VOLUME_IDENTITY_DRIFT", {
          observedSha256: createHash("sha256")
            .update(
              canonical({
                name: value.Name ?? null,
                birth: value.CreatedAt ?? null,
                driver: value.Driver ?? null,
              }),
            )
            .digest("hex"),
        });
    } else if (
      value.Id !== resource.identity ||
      value.Name !==
        (kind === "container" ? `/${resource.name}` : resource.name)
    )
      fail("IMMUTABLE_RESOURCE_DRIFT", {
        kind,
        observedSha256: createHash("sha256")
          .update(
            canonical({
              id: value.Id ?? null,
              name: value.Name ?? null,
            }),
          )
          .digest("hex"),
      });
    return value;
  }
  private async attachments(): Promise<void> {
    const attached = await this.call([
      "ps",
      "-a",
      "--no-trunc",
      "--filter",
      `volume=${this.state.volumeName}`,
      "--format",
      "{{.ID}}",
    ]);
    if (attached !== this.state.containerId)
      fail("FOREIGN_OR_MISSING_VOLUME_ATTACHMENT", {
        observedSha256: createHash("sha256").update(attached).digest("hex"),
      });
  }
  private async verifyLease(started: boolean): Promise<void> {
    if (!this.resources.every((resource) => resource.confirmed))
      fail("UNRESOLVED_CREATION");
    const volume = await this.inspect("volume");
    if (!volume.CreatedAt) fail("VOLUME_BIRTH_MISSING");
    const network = await this.inspect("network");
    const members = Object.keys(record(network.Containers));
    if (
      network.Internal !== true ||
      network.Driver !== "bridge" ||
      members.some((id) => id !== this.state.containerId) ||
      (started &&
        (members.length !== 1 || members[0] !== this.state.containerId))
    )
      fail("NETWORK_ISOLATION_MISMATCH");
    const container = await this.inspect("container");
    const config = record(container.Config),
      host = record(container.HostConfig);
    const networks = record(record(container.NetworkSettings).Networks);
    const names = Object.keys(networks);
    const mount =
      Array.isArray(container.Mounts) && container.Mounts.length === 1
        ? record(container.Mounts[0])
        : fail("CONTAINER_MOUNT_MISMATCH");
    if (
      container.Image !== this.options.resolvedImageId ||
      config.Image !== this.options.image ||
      host.Privileged !== false ||
      Object.keys(record(host.PortBindings ?? {})).length ||
      (Array.isArray(host.Binds) && host.Binds.length) ||
      host.NetworkMode !== this.state.networkId ||
      names.length !== 1 ||
      names[0] !== this.state.networkName ||
      (started &&
        record(networks[this.state.networkName]).NetworkID !==
          this.state.networkId) ||
      mount.Type !== "volume" ||
      mount.Name !== this.state.volumeName ||
      mount.Destination !== "/var/lib/postgresql/data" ||
      mount.RW !== true
    )
      fail("CONTAINER_ISOLATION_MISMATCH");
    await this.attachments();
  }
  /** B is a separately pinned G3-C operation. A never starts PostgreSQL or executes SQL. */
  async bootstrap(
    grant: OperatorGrant | null,
    reviewPin: Readonly<{ g3cSha256: string }>,
  ): Promise<
    Readonly<{ database: string; user: string; clusterIdentity: string }>
  > {
    this.enter();
    try {
      if (this.recoveryOnly) fail("CLEANUP_RECOVERY_ONLY");
      this.active = WindowsDockerLease.budget(
        this.options,
        this.state.owner,
        grantPayload(grant, reviewPin.g3cSha256, "G3-C"),
        "bootstrap",
      );
      this.exactResources(this.active.grant);
      if (this.state.status !== "ACQUIRED" || this.bootstrapped)
        fail("FRESH_BOOTSTRAP_REQUIRED");
      await this.verifyLease(false);
      await this.journal.event("BOOTSTRAP_INTENT");
      await this.call(["start", this.state.containerId!]);
      let ready = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        await this.daemon();
        const result = await this.raw(
          [
            "exec",
            this.state.containerId!,
            "pg_isready",
            "-h",
            "127.0.0.1",
            "-U",
            "postgres",
            "-d",
            "postgres",
          ],
          undefined,
          undefined,
          [0, 1, 2],
        );
        await this.daemon();
        if (this.success(result)) {
          ready = true;
          break;
        }
        if (
          result.timedOut ||
          result.signal ||
          result.spawnError ||
          (result.code !== 1 && result.code !== 2)
        )
          fail("POSTGRES_READINESS_UNCERTAIN");
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!ready) fail("POSTGRES_READINESS_DEADLINE");
      await this.verifyLease(true);
      const initial = JSON.parse(
        await this.sql(
          "postgres",
          "postgres",
          this.password,
          "SELECT json_build_object('database',current_database(),'user',current_user,'databases',(SELECT json_agg(datname ORDER BY datname) FROM pg_database WHERE NOT datistemplate),'publicTables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'cluster',(SELECT system_identifier::text FROM pg_control_system()))",
        ),
      );
      const before = record(initial);
      if (
        before.database !== "postgres" ||
        before.user !== "postgres" ||
        canonical(before.databases) !== canonical(["postgres"]) ||
        before.publicTables !== 0 ||
        typeof before.cluster !== "string" ||
        !/^\d+$/.test(before.cluster)
      )
        fail("FRESH_CLUSTER_IDENTITY_MISMATCH");
      const key = this.state.owner.replaceAll("-", "");
      const database = `stockwise_d5_${key}_test`,
        user = `stockwise_d5_${key}_owner`;
      const password = randomBytes(32).toString("base64url");
      await this.verifyLease(true);
      // Names and password are generated, never caller SQL. No project schema is reachable here.
      await this.sql(
        "postgres",
        "postgres",
        this.password,
        `CREATE ROLE ${user} LOGIN PASSWORD '${password}';\nCREATE DATABASE ${database} OWNER ${user};`,
        true,
      );
      const identity = record(
        JSON.parse(
          await this.sql(
            database,
            user,
            password,
            "SELECT json_build_object('database',current_database(),'user',current_user,'address',inet_server_addr()::text,'port',inet_server_port(),'publicTables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'))",
          ),
        ),
      );
      if (
        identity.database !== database ||
        identity.user !== user ||
        (identity.address !== "127.0.0.1/32" &&
          identity.address !== "127.0.0.1") ||
        identity.port !== 5432 ||
        identity.publicTables !== 0
      )
        fail("POSTGRES_TARGET_IDENTITY_MISMATCH");
      this.bootstrapped = true;
      await this.journal.event("BOOTSTRAP_CONFIRMED", {
        database,
        user,
        clusterIdentity: before.cluster,
      });
      return Object.freeze({ database, user, clusterIdentity: before.cluster });
    } catch (error) {
      Object.assign(this.state, { status: "INCOMPLETE" });
      await this.retainFailure(
        "BOOTSTRAP",
        this.errorCode(error),
        error instanceof LeaseContractFailure ? error.evidence : {},
      );
      await this.journal.event("BOOTSTRAP_INCOMPLETE");
      throw new Error("BOOTSTRAP_INCOMPLETE", { cause: error });
    } finally {
      this.leave();
    }
  }
  private sql(
    database: string,
    user: string,
    password: string,
    sql: string,
    bootstrap = false,
  ): Promise<string> {
    return this.call(
      [
        "exec",
        "--env",
        "PGPASSWORD",
        "-i",
        this.state.containerId!,
        "psql",
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        "127.0.0.1",
        "-U",
        user,
        "-d",
        database,
        ...(bootstrap ? ["-f", "-"] : ["-c", sql]),
      ],
      bootstrap ? sql : undefined,
      { PGPASSWORD: password },
    );
  }
  executeSchema(): never {
    return fail("SCHEMA_EXECUTION_UNAVAILABLE_IN_R2");
  }
  async cleanup(
    grant: OperatorGrant | null,
    reviewPin: Readonly<{ g3dSha256: string }>,
  ): Promise<Lease> {
    if (this.state.status === "CLEAN") return this.lease;
    this.enter();
    let phase = "authorization";
    const approvedDigest = reviewPin.g3dSha256;
    let verifiedAuthority: string | null = null;
    try {
      if (!grant) {
        Object.assign(this.state, { status: "INCOMPLETE" });
        await this.journal.event("CLEANUP_DEFERRED", {
          reason: "AWAITING_G3_D",
        });
        return this.lease;
      }
      const payload = grantPayload(grant, approvedDigest, "G3-D");
      verifiedAuthority = approvedDigest;
      this.active = {
        ...WindowsDockerLease.budget(
          this.options,
          this.state.owner,
          payload,
          "cleanup",
          this.state.runId,
        ),
        digest: approvedDigest,
      };
      this.exactResources(this.active.grant);
      const actions = this.active.grant.actions;
      if (
        !Array.isArray(actions) ||
        canonical(actions) !==
          canonical([
            "stop-5s-then-force",
            "remove-container",
            "remove-network",
            "remove-volume",
          ]) ||
        this.active.grant.exclusiveWindow !==
          "operator-prevents-concurrent-lease-mutation" ||
        this.active.grant.volumeRace !==
          "accept-non-atomic-volume-name-deletion"
      )
        fail("DESTRUCTIVE_OPERATION_SCOPE_REQUIRED");
      await this.journal.bindGrant(
        approvedDigest,
        this.active.grant.maxCommands as number,
        this.active.grant.expiresAt as number,
      );
      if (this.journal.unresolvedDestructive)
        fail("UNRESOLVED_DESTRUCTIVE_COMMAND");
      phase = "verify-lease";
      if (
        this.resources.some(
          (resource) => resource.attempted && !resource.confirmed,
        )
      )
        fail("UNQUIESCED_CREATION");
      await this.verifyLease(false);
      await this.journal.event("CLEANUP_INTENT", {
        containerId: this.state.containerId,
        networkId: this.state.networkId,
        volumeBirth: this.state.volumeBirth,
      });
      phase = "stop";
      await this.call(["stop", "--time", "5", this.state.containerId!]);
      await this.verifyLease(false);
      phase = "remove-container";
      await this.call(["container", "rm", this.state.containerId!]);
      phase = "remove-network";
      const network = await this.inspect("network");
      if (Object.keys(record(network.Containers)).length !== 0)
        fail("FOREIGN_NETWORK_MEMBER");
      await this.call(["network", "rm", this.state.networkId!]);
      phase = "remove-volume";
      await this.inspect("volume");
      const attached = await this.call([
        "ps",
        "-a",
        "--no-trunc",
        "--filter",
        `volume=${this.state.volumeName}`,
        "--format",
        "{{.ID}}",
      ]);
      if (attached) fail("VOLUME_STILL_ATTACHED");
      // Final birth check narrows but cannot eliminate Docker's name-delete replacement race.
      await this.inspect("volume");
      await this.call(["volume", "rm", this.state.volumeName]);
      phase = "absence";
      if (this.hasResources(await this.inventory()))
        fail("FINAL_RESOURCES_REMAIN");
      for (const resource of this.resources) {
        await this.daemon();
        const result = await this.raw(
          [
            resource.kind,
            "inspect",
            resource.kind === "volume" ? resource.name : resource.identity!,
          ],
          undefined,
          undefined,
          [1],
        );
        await this.daemon();
        const target =
          resource.kind === "volume" ? resource.name : resource.identity!;
        if (
          result.code !== 1 ||
          result.signal !== null ||
          result.timedOut ||
          result.spawnError ||
          !result.stderr.includes(target) ||
          !/no such (?:object|container|network|volume)|not found/i.test(
            result.stderr,
          )
        )
          fail("FINAL_ABSENCE_UNPROVEN");
        await this.journal.event("ABSENCE_CONFIRMED", {
          kind: resource.kind,
          name: resource.name,
          identity: resource.identity,
        });
      }
      Object.assign(this.state, { status: "CLEAN" });
      await this.journal.event("CLEANUP_COMPLETE", {
        failures: this.journal.failureCount,
      });
      await this.journal.releaseComplete();
    } catch (error) {
      Object.assign(this.state, { status: "INCOMPLETE" });
      const code = this.errorCode(error);
      if (
        code !== "DOCKER_COMMAND_FAILED" &&
        code !== "DOCKER_TRANSPORT_UNCERTAIN" &&
        code !== "DOCKER_COMMAND_NOT_DISPATCHED"
      ) {
        const category =
          /^(?:OPERATOR_|CLEANUP_GRANT_|EXACT_RESOURCE_AUTHORIZATION|DESTRUCTIVE_OPERATION_SCOPE)/.test(
            code,
          )
            ? "AUTHORIZATION"
            : error instanceof LeaseJournalError ||
                code === "CLEANUP_UNEXPECTED_FAILURE"
              ? "EVIDENCE"
              : "SAFETY";
        await this.retainFailure(category, code, {
          phase,
          authorityDigest: verifiedAuthority,
          ...(error instanceof LeaseContractFailure ? error.evidence : {}),
        });
      }
      await this.journal.event("CLEANUP_INCOMPLETE", {
        reason: code,
        phase,
        failures: this.journal.failureCount,
      });
    } finally {
      this.leave();
    }
    return this.lease;
  }
}

export function assertWindowsLeasePass(lease: Lease): void {
  if (
    lease.status !== "CLEAN" ||
    lease.verdict !== "PASS" ||
    lease.failureCount !== 0 ||
    lease.failures.length !== 0
  )
    fail("WINDOWS_LEASE_NOT_PASS");
}
