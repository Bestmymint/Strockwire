import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  realpath,
  stat,
  appendFile,
  readFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OWNER_LABEL = "stockwise.local.owner";
const TOKEN_LABEL = "stockwise.local.token";
const ROLE_LABEL = "stockwise.local.role";

const MAX_OUTPUT = 1024 * 1024;
const COMMAND_TIMEOUT = 30_000;
const RUN_TIMEOUT = 15 * 60_000;

type DockerResult = Readonly<{
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}>;
export type LocalDockerTransport = (
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  environment: NodeJS.ProcessEnv,
) => Promise<DockerResult>;
export type LocalPostgresOptions = Readonly<{
  image: string;
  evidenceDirectory: string;
  dockerExecutable: string;
  transport?: LocalDockerTransport;
  commandTimeoutMs?: number;
  runTimeoutMs?: number;
  cleanupGraceMs?: number;
}>;
export type LocalPostgresReceipt = Readonly<{
  owner: string;
  runId: string;
  database: "stockwise_test";
  testDatabase: "stockwise_test_test";
  host: "127.0.0.1";
  port: string;
  marker: string;
}>;
export type LocalPostgresConnection = Readonly<{
  DATABASE_URL: string;
  TEST_DATABASE_URL: string;
  receipt: LocalPostgresReceipt;
  smoke: () => Promise<void>;
  signal: AbortSignal;
}>;
const issuedReceipts = new WeakSet<object>();
export function isLocalPostgresReceipt(
  value: unknown,
): value is LocalPostgresReceipt {
  return !!value && typeof value === "object" && issuedReceipts.has(value);
}
export function verifyLocalPostgresReceipt(
  value: unknown,
  databaseUrl: string,
  testDatabaseUrl: string,
): value is LocalPostgresReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as LocalPostgresReceipt;
  if (
    !/^[a-f0-9-]{36}$/.test(receipt.owner) ||
    !/^[a-f0-9-]{36}$/.test(receipt.runId) ||
    receipt.database !== "stockwise_test" ||
    receipt.testDatabase !== "stockwise_test_test" ||
    receipt.host !== "127.0.0.1" ||
    !/^\d{1,5}$/.test(receipt.port) ||
    !/^[A-Za-z0-9_-]{43}$/.test(receipt.marker)
  )
    return false;
  try {
    const app = new URL(databaseUrl);
    const test = new URL(testDatabaseUrl);
    return (
      [app, test].every(
        (url) =>
          url.protocol === "postgresql:" &&
          url.hostname === receipt.host &&
          url.port === receipt.port,
      ) &&
      app.pathname === `/${receipt.database}` &&
      test.pathname === `/${receipt.testDatabase}`
    );
  } catch {
    return false;
  }
}
type Resource = "container" | "network" | "volume";
type RecordValue = Record<string, unknown>;
type Acquired = {
  kind: Resource;
  name: string;
  id: string | null;
  createdAt: string | null;
  role: string;
  attempted: boolean;
};
function safeDiagnostic(
  error: unknown,
  password: string,
  marker: string,
): string {
  const message = error instanceof Error ? error.message : "UNKNOWN_FAILURE";
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[database-url]")
    .replaceAll(password, "[redacted]")
    .replaceAll(marker, "[redacted]")
    .slice(0, 1024);
}

const cleanEnvironment = (): NodeJS.ProcessEnv => {
  const allowed = [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed)
    if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
};
const defaultTransport: LocalDockerTransport = async (
  executable,
  args,
  timeoutMs,
  environment,
) => {
  try {
    const result = await execFileAsync(executable, args, {
      env: environment,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: 0,
      timedOut: false,
    };
  } catch (error) {
    const failure = error as {
      stdout?: unknown;
      stderr?: unknown;
      code?: unknown;
      killed?: unknown;
    };
    return {
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : "",
      code: typeof failure.code === "number" ? failure.code : null,
      timedOut: failure.killed === true,
    };
  }
};
function labelsOf(value: RecordValue, kind: Resource): Record<string, string> {
  const config = value.Config as RecordValue | undefined;
  const labels = (
    kind === "container" ? config?.Labels : value.Labels
  ) as unknown;
  if (!labels || typeof labels !== "object" || Array.isArray(labels))
    throw new Error("RESOURCE_LABELS_INVALID");
  return labels as Record<string, string>;
}
function entry(kind: Resource, name: string, role: string): Acquired {
  return { kind, name, id: null, createdAt: null, role, attempted: false };
}

/** Runs host-native tests against a uniquely named, bounded, disposable local PostgreSQL instance. */
export async function withLocalPostgres<T>(
  options: LocalPostgresOptions,
  callback: (connection: LocalPostgresConnection) => Promise<T>,
): Promise<T> {
  const image = options.image;
  const match = /^postgres:(16\.[0-9]+-alpine)@(sha256:[a-f0-9]{64})$/.exec(
    image,
  );
  if (
    !match ||
    !isAbsolute(options.dockerExecutable) ||
    !isAbsolute(options.evidenceDirectory)
  )
    throw new Error("LOCAL_RUNNER_OPTIONS_INVALID");
  const executable = await realpath(options.dockerExecutable);
  const initial = await lstat(options.dockerExecutable);
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    !executable.toLowerCase().endsWith(".exe") ||
    executable.toLowerCase() !== resolve(options.dockerExecutable).toLowerCase()
  )
    throw new Error("DOCKER_EXECUTABLE_IDENTITY_INVALID");
  const binaryHash = createHash("sha256")
    .update(await readFile(executable))
    .digest("hex");
  const binary = await stat(executable);
  const binaryIdentity = {
    size: binary.size,
    mtimeMs: binary.mtimeMs,
    ino: binary.ino,
  };
  const sameExecutable = async () => {
    const current = await stat(executable);
    if (
      current.size !== binaryIdentity.size ||
      current.mtimeMs !== binaryIdentity.mtimeMs ||
      current.ino !== binaryIdentity.ino ||
      createHash("sha256")
        .update(await readFile(executable))
        .digest("hex") !== binaryHash
    )
      throw new Error("DOCKER_EXECUTABLE_IDENTITY_CHANGED");
  };
  const owner = randomUUID();
  const runId = randomUUID();
  const token = randomUUID();
  const prefix = `stockwise-local-${owner}`;
  const resources = [
    entry("network", `${prefix}-network`, "network"),
    entry("volume", `${prefix}-data`, "volume"),
    entry("container", `${prefix}-postgres`, "postgres"),
  ];
  const journal = join(options.evidenceDirectory, `${owner}.jsonl`);
  await mkdir(options.evidenceDirectory, { recursive: true });
  const record = async (event: string, data: RecordValue = {}) => {
    // Never journal the generated password, URLs, or process environment.
    await appendFile(
      journal,
      `${JSON.stringify({ time: new Date().toISOString(), owner, runId, token, event, ...data })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  };
  const transport = options.transport ?? defaultTransport;
  const environment = cleanEnvironment();
  const invoke = async (args: string[], timeoutMs: number) => {
    await sameExecutable();
    return transport(
      executable,
      ["--host", "npipe:////./pipe/docker_engine", ...args],
      timeoutMs,
      environment,
    );
  };
  let daemonIdentity: string | null = null;
  const docker = async (
    args: string[],
    timeoutMs = options.commandTimeoutMs ?? COMMAND_TIMEOUT,
  ): Promise<string> => {
    const daemon = await invoke(["info", "--format", "{{.ID}}"], timeoutMs);
    const observedDaemon = daemon.stdout.trim();
    if (
      daemon.timedOut ||
      daemon.code !== 0 ||
      !/^[a-f0-9-]{36}$/.test(observedDaemon) ||
      (daemonIdentity !== null && observedDaemon !== daemonIdentity)
    )
      throw new Error("DOCKER_DAEMON_IDENTITY_MISMATCH");
    daemonIdentity ??= observedDaemon;
    const result = await invoke(args, timeoutMs);
    if (result.timedOut) throw new Error("DOCKER_COMMAND_TIMED_OUT");
    if (result.code !== 0)
      throw new Error(`DOCKER_COMMAND_FAILED_${String(result.code)}`);
    return (
      args[0] === "logs" ? result.stdout + result.stderr : result.stdout
    ).trim();
  };
  const inspect = async (resource: Acquired): Promise<RecordValue> => {
    const command =
      resource.kind === "container"
        ? ["container", "inspect", resource.id ?? resource.name]
        : resource.kind === "network"
          ? ["network", "inspect", resource.id ?? resource.name]
          : ["volume", "inspect", resource.name];
    const parsed: unknown = JSON.parse(await docker(command));
    if (!Array.isArray(parsed) || parsed.length !== 1)
      throw new Error("RESOURCE_INSPECT_COUNT_INVALID");
    const value = parsed[0] as RecordValue;
    if (
      !value ||
      labelsOf(value, resource.kind)[OWNER_LABEL] !== owner ||
      labelsOf(value, resource.kind)[TOKEN_LABEL] !== token ||
      labelsOf(value, resource.kind)[ROLE_LABEL] !== resource.role
    )
      throw new Error("RESOURCE_OWNERSHIP_MISMATCH");
    if (resource.kind === "volume") {
      if (
        value.Name !== resource.name ||
        typeof value.CreatedAt !== "string" ||
        value.Driver !== "local" ||
        Object.keys((value.Options as RecordValue | undefined) ?? {}).length !==
          0 ||
        (resource.createdAt !== null && value.CreatedAt !== resource.createdAt)
      )
        throw new Error("VOLUME_CREATION_IDENTITY_MISMATCH");
      resource.createdAt = value.CreatedAt;
    } else {
      const id = value.Id;
      if (
        typeof id !== "string" ||
        !/^[a-f0-9]{64}$/.test(id) ||
        (resource.id !== null && resource.id !== id)
      )
        throw new Error("RESOURCE_IDENTITY_MISMATCH");
      resource.id = id;
      if (resource.kind === "container" && value.Name !== `/${resource.name}`)
        throw new Error("CONTAINER_NAME_MISMATCH");
      if (
        resource.kind === "network" &&
        (value.Name !== resource.name ||
          value.Driver !== "bridge" ||
          value.Internal !== false)
      )
        throw new Error("NETWORK_CONFIGURATION_MISMATCH");
    }
    return value;
  };
  const resourceExistsByName = async (resource: Acquired): Promise<boolean> => {
    const output =
      resource.kind === "container"
        ? await docker([
            "ps",
            "--all",
            "--no-trunc",
            "--format",
            "{{.ID}}|{{.Names}}",
          ])
        : resource.kind === "network"
          ? await docker([
              "network",
              "ls",
              "--no-trunc",
              "--format",
              "{{.ID}}|{{.Name}}",
            ])
          : await docker(["volume", "ls", "--format", "{{.Name}}"]);
    return output.split(/\r?\n/).some((line) => {
      const fields = line.split("|");
      return (
        fields.includes(resource.name) ||
        (resource.id !== null && fields.includes(resource.id))
      );
    });
  };
  let failed: unknown = null;
  let cleanupIncomplete = false;
  let callbackResult: T | undefined;
  let callbackPromise: Promise<T> | null = null;
  let callbackAbort: AbortController | null = null;
  let callbackTimedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const marker = randomBytes(32).toString("base64url");
  const password = randomBytes(32).toString("base64url");
  try {
    await record("RUN_STARTED", {
      image,
      resourceNames: resources.map(({ kind, name }) => ({ kind, name })),
    });
    const imageInspection: unknown = JSON.parse(
      await docker(["image", "inspect", image]),
    );
    if (!Array.isArray(imageInspection) || imageInspection.length !== 1)
      throw new Error("POSTGRES_IMAGE_INSPECTION_INVALID");
    const imageJson = imageInspection[0] as RecordValue;
    if (
      typeof imageJson.Id !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(imageJson.Id) ||
      !Array.isArray(imageJson.RepoDigests) ||
      !imageJson.RepoDigests.includes(`postgres@${match[2]}`) ||
      !Array.isArray(imageJson.RepoTags) ||
      !imageJson.RepoTags.includes(`postgres:${match[1]}`)
    )
      throw new Error("POSTGRES_IMAGE_IDENTITY_MISMATCH");
    const resolvedImageId = imageJson.Id;
    await record("IMAGE_RESOLVED", { image, resolvedImageId });
    const imageConfig = imageJson.Config as RecordValue | undefined;
    const imageEnvironment = imageConfig?.Env as string[] | undefined;
    const major =
      imageEnvironment?.filter((value) => value.startsWith("PG_MAJOR=")) ?? [];
    const version =
      imageEnvironment?.filter((value) => value.startsWith("PG_VERSION=")) ??
      [];
    if (
      imageJson.Os !== "linux" ||
      imageJson.Architecture !== "amd64" ||
      major.length !== 1 ||
      major[0] !== "PG_MAJOR=16" ||
      version.length !== 1 ||
      !/^PG_VERSION=16\.[0-9]+$/.test(version[0]!)
    )
      throw new Error("POSTGRES_IMAGE_METADATA_MISMATCH");
    for (const resource of resources) {
      resource.attempted = true;
      await record("CREATE_INTENT", {
        kind: resource.kind,
        name: resource.name,
        role: resource.role,
      });
      if (resource.kind === "network") {
        // Host-native clients need published loopback access; Docker internal networks suppress that mapping.
        const id = await docker([
          "network",
          "create",
          "--label",
          `${OWNER_LABEL}=${owner}`,
          "--label",
          `${TOKEN_LABEL}=${token}`,
          "--label",
          `${ROLE_LABEL}=${resource.role}`,
          resource.name,
        ]);
        if (!/^[a-f0-9]{64}$/.test(id))
          throw new Error("NETWORK_CREATE_ID_INVALID");
        resource.id = id;
      } else if (resource.kind === "volume") {
        const created = await docker([
          "volume",
          "create",
          "--label",
          `${OWNER_LABEL}=${owner}`,
          "--label",
          `${TOKEN_LABEL}=${token}`,
          "--label",
          `${ROLE_LABEL}=${resource.role}`,
          resource.name,
        ]);
        if (created !== resource.name)
          throw new Error("VOLUME_CREATE_RESPONSE_MISMATCH");
      } else {
        const args = [
          "container",
          "create",
          "--pull=never",
          "--name",
          resource.name,
          "--label",
          `${OWNER_LABEL}=${owner}`,
          "--label",
          `${TOKEN_LABEL}=${token}`,
          "--label",
          `${ROLE_LABEL}=${resource.role}`,
          "--network",
          resources[0]!.name,
          "--network-alias",
          "postgres",
          "--cpus=2",
          "--memory=1g",
          "--memory-swap=1g",
          "--pids-limit=128",
          "--user=postgres",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--init",
          "--restart=no",
          "--tmpfs",
          "/var/run/postgresql:rw,noexec,nosuid,size=16m",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=64m",
          "--mount",
          `type=volume,src=${resources[1]!.name},dst=/var/lib/postgresql/data`,
          "-p",
          "127.0.0.1::5432",
          "--env",
          "POSTGRES_USER=stockwise_test",
          "--env",
          "POSTGRES_DB=stockwise_test",
          "--env",
          `POSTGRES_PASSWORD=${password}`,
          image,
          "postgres",
          "-c",
          "max_connections=40",
          "-c",
          "shared_buffers=128MB",
        ];
        const id = await docker(args);
        if (!/^[a-f0-9]{64}$/.test(id))
          throw new Error("CONTAINER_CREATE_ID_INVALID");
        resource.id = id;
      }
      const value = await inspect(resource);
      if (resource.kind === "container") {
        const host = value.HostConfig as RecordValue | undefined;
        const config = value.Config as RecordValue | undefined;
        const networkSettings = value.NetworkSettings as
          RecordValue | undefined;
        const portBindings = host?.PortBindings as RecordValue | undefined;
        const binding = (
          portBindings?.["5432/tcp"] as RecordValue[] | undefined
        )?.[0];
        const mounts = value.Mounts as RecordValue[] | undefined;
        const dataMounts =
          mounts?.filter((mount) => mount.Type === "volume") ?? [];
        const tmpfs = host?.Tmpfs as RecordValue | undefined;
        const environment = config?.Env as string[] | undefined;
        const network = (
          networkSettings?.Networks as RecordValue | undefined
        )?.[resources[0]!.name] as RecordValue | undefined;
        if (
          value.Image !== resolvedImageId ||
          config?.Image !== image ||
          config.User !== "postgres" ||
          host?.Memory !== 1024 ** 3 ||
          host?.MemorySwap !== host.Memory ||
          host?.NanoCpus !== 2_000_000_000 ||
          host?.PidsLimit !== 128 ||
          host?.ReadonlyRootfs !== true ||
          host?.Privileged === true ||
          host?.NetworkMode !== resources[0]!.name ||
          !(host.CapDrop as string[] | undefined)?.includes("ALL") ||
          !(host.SecurityOpt as string[] | undefined)?.includes(
            "no-new-privileges",
          ) ||
          (host.RestartPolicy as RecordValue | undefined)?.Name !== "no" ||
          binding?.HostIp !== "127.0.0.1" ||
          binding.HostPort !== "" ||
          !network ||
          (network.NetworkID !== resources[0]!.id &&
            !(
              (value.State as RecordValue | undefined)?.Status === "created" &&
              network.NetworkID === ""
            )) ||
          !Array.isArray(mounts) ||
          mounts.some(
            (mount) => mount.Type !== "volume" && mount.Type !== "tmpfs",
          ) ||
          dataMounts.length !== 1 ||
          dataMounts[0]?.Name !== resources[1]!.name ||
          dataMounts[0]?.Destination !== "/var/lib/postgresql/data" ||
          dataMounts[0]?.RW !== true ||
          !tmpfs ||
          !tmpfs["/tmp"] ||
          !tmpfs["/var/run/postgresql"] ||
          !Array.isArray(environment) ||
          !environment.includes("POSTGRES_USER=stockwise_test") ||
          !environment.includes("POSTGRES_DB=stockwise_test") ||
          !environment.includes(`POSTGRES_PASSWORD=${password}`)
        )
          throw new Error("POSTGRES_CONTAINER_CONFIGURATION_MISMATCH");
      }
      await record("RESOURCE_ACQUIRED", {
        kind: resource.kind,
        name: resource.name,
        id: resource.id,
        createdAt: resource.createdAt,
      });
    }
    const container = resources[2]!;
    await docker(["container", "start", container.id!]);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await docker(
          [
            "exec",
            container.id!,
            "pg_isready",
            "-U",
            "stockwise_test",
            "-d",
            "postgres",
          ],
          5_000,
        );
        ready = true;
        break;
      } catch {
        const current = await inspect(container);
        if ((current.State as RecordValue | undefined)?.Running !== true)
          throw new Error("POSTGRES_EXITED_BEFORE_READY");
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    if (!ready) throw new Error("POSTGRES_STARTUP_TIMED_OUT");
    await docker([
      "exec",
      container.id!,
      "psql",
      "-U",
      "stockwise_test",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "CREATE DATABASE stockwise_test_test",
    ]);
    await docker([
      "exec",
      container.id!,
      "psql",
      "-U",
      "stockwise_test",
      "-d",
      "stockwise_test_test",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `COMMENT ON DATABASE stockwise_test_test IS 'stockwise-local:${marker}'`,
    ]);
    const liveContainer = await inspect(container);
    const liveNetworks = (liveContainer.NetworkSettings as RecordValue)
      .Networks as RecordValue;
    if (
      Object.keys(liveNetworks).length !== 1 ||
      (liveNetworks[resources[0]!.name] as RecordValue | undefined)
        ?.NetworkID !== resources[0]!.id
    )
      throw new Error("POSTGRES_LIVE_NETWORK_IDENTITY_MISMATCH");
    const ports = (liveContainer.NetworkSettings as RecordValue).Ports as
      RecordValue | undefined;
    await record("POSTGRES_READY", { publishedPorts: ports });
    const bindings = ports?.["5432/tcp"] as
      { HostIp?: string; HostPort?: string }[] | null | undefined;
    const binding = bindings?.find(
      (item) =>
        item.HostIp === "127.0.0.1" && /^\d+$/.test(item.HostPort ?? ""),
    );
    if (!binding) throw new Error("LOOPBACK_PORT_BINDING_INVALID");
    const appUrl = `postgresql://stockwise_test:${encodeURIComponent(password)}@127.0.0.1:${binding.HostPort}/stockwise_test`;
    const testUrl = `postgresql://stockwise_test:${encodeURIComponent(password)}@127.0.0.1:${binding.HostPort}/stockwise_test_test`;
    const receipt = Object.freeze({
      owner,
      runId,
      database: "stockwise_test" as const,
      testDatabase: "stockwise_test_test" as const,
      host: "127.0.0.1" as const,
      port: binding.HostPort!,
      marker,
    });
    issuedReceipts.add(receipt);
    if (!verifyLocalPostgresReceipt(receipt, appUrl, testUrl))
      throw new Error("LOCAL_RECEIPT_INVALID");
    await record("CALLBACK_STARTED");
    callbackAbort = new AbortController();
    const connection: LocalPostgresConnection = {
      DATABASE_URL: appUrl,
      TEST_DATABASE_URL: testUrl,
      receipt,
      signal: callbackAbort.signal,
      smoke: async () => {
        const result = await docker([
          "exec",
          container.id!,
          "psql",
          "-XAt",
          "-U",
          "stockwise_test",
          "-d",
          "stockwise_test_test",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "SELECT 1",
        ]);
        if (result !== "1")
          throw new Error("LOCAL_POSTGRES_SMOKE_QUERY_FAILED");
      },
    };
    callbackPromise = Promise.resolve().then(() => callback(connection));
    callbackResult = await Promise.race([
      callbackPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          callbackTimedOut = true;
          callbackAbort?.abort();
          reject(new Error("LOCAL_TEST_RUN_TIMED_OUT"));
        }, options.runTimeoutMs ?? RUN_TIMEOUT);
      }),
    ]);
    await record("CALLBACK_COMPLETED", { verdict: "PASS" });
  } catch (error) {
    const diagnostic = safeDiagnostic(error, password, marker);
    failed =
      error instanceof Error && diagnostic === error.message
        ? error
        : new Error(diagnostic);
    await record("RUN_FAILED", { error: diagnostic, verdict: "FAIL" }).catch(
      () => undefined,
    );
    const container = resources[2]!;
    if (container.id) {
      try {
        await inspect(container);
        const logs = await docker(
          ["logs", "--tail", "80", container.id],
          5_000,
        );
        await record("CONTAINER_DIAGNOSTICS", {
          output: safeDiagnostic(new Error(logs), password, marker),
        });
      } catch {
        await record("CONTAINER_DIAGNOSTICS_UNAVAILABLE").catch(
          () => undefined,
        );
      }
    }
  }
  clearTimeout(timeout);
  let callbackQuiescent = true;
  if (callbackTimedOut && callbackPromise) {
    let graceTimer: NodeJS.Timeout | undefined;
    const settled = await Promise.race([
      callbackPromise.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolveGrace) => {
        graceTimer = setTimeout(
          () => resolveGrace(false),
          options.cleanupGraceMs ?? 30_000,
        );
      }),
    ]);
    clearTimeout(graceTimer);
    callbackQuiescent = settled;
    if (!settled) {
      cleanupIncomplete = true;
      await record("CALLBACK_NOT_QUIESCENT", { verdict: "INCOMPLETE" }).catch(
        () => undefined,
      );
    }
  }
  for (const resource of callbackQuiescent ? [...resources].reverse() : []) {
    try {
      if (
        resource.attempted &&
        (resource.kind === "volume" ? !resource.createdAt : !resource.id)
      ) {
        try {
          await inspect(resource);
        } catch {
          let absent = false;
          try {
            absent = !(await resourceExistsByName(resource));
          } catch {
            /* identity remains uncertain */
          }
          if (absent) {
            // Absence cannot prove a timed-out daemon create has finished.
            cleanupIncomplete = true;
            await record("CREATE_NOT_PRESENT", {
              kind: resource.kind,
              name: resource.name,
              verdict: "INCOMPLETE",
            });
            continue;
          }
          cleanupIncomplete = true;
          failed ??= new Error("RESOURCE_CREATE_IDENTITY_UNRESOLVED");
          await record("CLEANUP_FAILED", {
            kind: resource.kind,
            name: resource.name,
            error: "RESOURCE_CREATE_IDENTITY_UNRESOLVED",
            verdict: "INCOMPLETE",
          });
          continue;
        }
      }
      if (resource.kind === "container") {
        if (!resource.id) continue;
        const observed = await inspect(resource);
        const state = observed.State as RecordValue | undefined;
        if (state?.Running === true)
          await docker(["container", "stop", "--time", "5", resource.id]);
        const stopped = await inspect(resource);
        const stoppedState = stopped.State as RecordValue | undefined;
        if (stoppedState?.Running === true)
          throw new Error("CONTAINER_STOP_UNCONFIRMED");
        await docker(["container", "rm", resource.id]);
        if (await resourceExistsByName(resource))
          throw new Error("CONTAINER_REMOVAL_UNCONFIRMED");
      } else if (resource.kind === "network") {
        if (!resource.id) continue;
        const network = await inspect(resource);
        const attached = network.Containers as RecordValue | undefined;
        if (attached && Object.keys(attached).length)
          throw new Error("NETWORK_HAS_UNEXPECTED_ATTACHMENTS");
        await docker(["network", "rm", resource.id]);
        if (await resourceExistsByName(resource))
          throw new Error("NETWORK_REMOVAL_UNCONFIRMED");
      } else {
        if (!resource.createdAt) continue;
        await inspect(resource);
        const users = await docker([
          "ps",
          "--all",
          "--no-trunc",
          "--filter",
          `volume=${resource.name}`,
          "--format",
          "{{.ID}}",
        ]);
        if (users) throw new Error("VOLUME_HAS_UNEXPECTED_ATTACHMENTS");
        await docker(["volume", "rm", resource.name]);
        if (await resourceExistsByName(resource))
          throw new Error("VOLUME_REMOVAL_UNCONFIRMED");
      }
      await record("RESOURCE_REMOVED", {
        kind: resource.kind,
        name: resource.name,
        id: resource.id,
        createdAt: resource.createdAt,
      });
    } catch (error) {
      cleanupIncomplete = true;
      failed ??= error;
      await record("CLEANUP_FAILED", {
        kind: resource.kind,
        name: resource.name,
        error: error instanceof Error ? error.message : "UNKNOWN_FAILURE",
        verdict: "INCOMPLETE",
      }).catch(() => undefined);
    }
  }
  await record("RUN_FINISHED", {
    verdict: failed ? "FAIL" : "PASS",
    cleanup: cleanupIncomplete ? "INCOMPLETE" : "COMPLETE",
  });
  if (failed) throw failed;
  return callbackResult as T;
}
