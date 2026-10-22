import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { z } from "zod";
import { loadTestDatabaseEnvironment } from "./database-environment.ts";
import {
  authBounded,
  createAuthCleanup,
} from "./auth-integration-lifecycle.ts";
import {
  applyTestDatabaseMigrations,
  provisionTestDatabase,
} from "./database-harness.ts";

export function authIntegrationResources(owner: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      owner,
    )
  )
    throw new Error("Invalid disposable resource lease.");
  const project = `stockwise-t02a-${owner}`;
  return Object.freeze({
    project,
    container: `${project}-postgres`,
    volume: `${project}-postgres-data`,
    network: `${project}_default`,
    database: "stockwise_t02a_auth_test",
    port: 56221,
    image: "postgres:16.15-alpine",
  });
}
export const AUTH_INTEGRATION_APPROVAL =
  "create-new-disposable-t02a-auth-database";
const ownerLabel = "stockwise.t02a.owner";
const exec = promisify(execFile);
const composeFile = fileURLToPath(
  new URL(
    "../../../../tests/e2e/auth-integration/compose.yaml",
    import.meta.url,
  ),
);

export function validateAuthIntegrationInvocation(
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (
    environment.STOCKWISE_T02A_INTEGRATION_AUTHORIZE !==
    AUTH_INTEGRATION_APPROVAL
  )
    throw new Error(
      "Separate disposable database execution authorization is required.",
    );
  for (const [key, value] of Object.entries(environment)) {
    // Playwright sets this exact internal worker marker; it is not a debug override.
    if (key === "PLAYWRIGHT_TEST" && value === "1") continue;
    if (
      value !== undefined &&
      /^(?:DATABASE_URL|TEST_DATABASE_URL|STOCKWISE_ALLOW_STOCKWISE_TEST|PG.*|DOCKER_HOST|DOCKER_CONTEXT|COMPOSE_.*|DEBUG|PWDEBUG|PW_TEST_.*|PLAYWRIGHT_.*|RESEND_API_KEY|OPENROUTER_API_KEY|STOCKWISE_EMAIL_.*|STOCKWISE_POSTGRES_.*|STOCKWISE_VERIFICATION_.*|STOCKWISE_T02A_DB_.*|STOCKWISE_T02A_OWNER|STOCKWISE_T02A_PROJECT)$/.test(
        key,
      )
    )
      throw new Error(
        "Inherited database, provider, browser-debug, or container configuration refused.",
      );
  }
}

export async function requireFreeLoopbackPort(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(new Error("Dedicated integration port is unavailable.")),
    );
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });
}

export function requireAbsentResources(
  inventory: {
    containers: string[];
    volumes: string[];
    networks: string[];
    projectContainers: string[];
  },
  r: ReturnType<typeof authIntegrationResources>,
) {
  if (
    inventory.containers.includes(r.container) ||
    inventory.volumes.includes(r.volume) ||
    inventory.networks.includes(r.network) ||
    inventory.projectContainers.length !== 0
  )
    throw new Error(
      "Integration resources already exist; reuse and cleanup refused.",
    );
}

export function requireOwner(
  labels: Record<string, string> | null,
  owner: string,
) {
  if (!labels || labels[ownerLabel] !== owner || !/^[a-f0-9-]{36}$/.test(owner))
    throw new Error("Integration resource ownership cannot be established.");
}

export function requireFreshDatabaseInventory(names: string[]) {
  if (names.length !== 1 || names[0] !== "postgres")
    throw new Error(
      "Unexpected existing disposable-cluster databases; setup refused.",
    );
}

export type AuthDockerCommand = (
  args: string[],
  environment: Record<string, string | undefined>,
) => Promise<string>;

const executeDocker: AuthDockerCommand = async (args, environment) =>
  (
    await exec("docker", args, {
      env: environment,
      windowsHide: true,
      timeout: args[0] === "compose" ? 90_000 : 8_000,
      maxBuffer: 1_000_000,
    })
  ).stdout.trim();

// The lease and generated credentials never enter a file.
export async function createOwnedAuthResources(
  environment: Readonly<Record<string, string | undefined>>,
  command: AuthDockerCommand = executeDocker,
) {
  validateAuthIntegrationInvocation(environment);
  const owner = randomUUID();
  const r = authIntegrationResources(owner);
  const username = `t02a_${randomBytes(8).toString("hex")}`;
  const password = randomBytes(32).toString("base64url");
  const childEnvironment = {
    ...environment,
    STOCKWISE_T02A_OWNER: owner,
    STOCKWISE_T02A_PROJECT: r.project,
    STOCKWISE_T02A_DB_USER: username,
    STOCKWISE_T02A_DB_PASSWORD: password,
  };
  async function docker(args: string[]) {
    try {
      return (await command(args, childEnvironment)).trim();
    } catch {
      throw new Error(
        "Disposable container operation failed; inspect task-owned resource metadata before recovery.",
      );
    }
  }
  const endpoint = await docker([
    "context",
    "inspect",
    "--format",
    "{{.Endpoints.docker.Host}}",
  ]);
  if (!/^(?:unix:\/\/\/|npipe:\/\/\/\/\.\/pipe\/)/.test(endpoint))
    throw new Error(
      "Integration requires a local Docker engine; remote context refused.",
    );
  const lines = (value: string) => (value === "" ? [] : value.split(/\r?\n/));
  const [containers, volumes, networks, projectContainers] = await Promise.all([
    docker(["ps", "-a", "--format", "{{.Names}}"]),
    docker(["volume", "ls", "--format", "{{.Name}}"]),
    docker(["network", "ls", "--format", "{{.Name}}"]),
    docker([
      "ps",
      "-a",
      "--filter",
      `label=com.docker.compose.project=${r.project}`,
      "--format",
      "{{.ID}}",
    ]),
  ]);
  requireAbsentResources(
    {
      containers: lines(containers),
      volumes: lines(volumes),
      networks: lines(networks),
      projectContainers: lines(projectContainers),
    },
    r,
  );
  for (const kind of ["volume", "network"] as const)
    if (
      (await docker([
        kind,
        "ls",
        "--filter",
        `label=com.docker.compose.project=${r.project}`,
        "--format",
        "{{.Name}}",
      ])) !== ""
    )
      throw new Error(
        "Unexpected existing Compose project resources; setup refused.",
      );
  const labelsSchema = z.record(z.string(), z.string()).nullable();
  const resourceSchema = z.array(
    z.object({
      Id: z.string().optional(),
      Name: z.string().optional(),
      CreatedAt: z.string().optional(),
      Containers: z.record(z.string(), z.unknown()).optional(),
      Labels: labelsSchema.optional(),
      Config: z.object({ Image: z.string(), Labels: labelsSchema }).optional(),
      Mounts: z
        .array(
          z.object({
            Type: z.string(),
            Name: z.string().optional(),
            Destination: z.string(),
          }),
        )
        .optional(),
      HostConfig: z
        .object({
          PortBindings: z.record(
            z.string(),
            z
              .array(z.object({ HostIp: z.string(), HostPort: z.string() }))
              .nullable(),
          ),
        })
        .optional(),
    }),
  );
  async function inspect(
    kind: "container" | "volume" | "network",
    name: string,
  ) {
    try {
      const result = resourceSchema.parse(
        JSON.parse(await docker([kind, "inspect", name])),
      )[0];
      if (!result) throw new Error();
      requireOwner(result.Config?.Labels ?? result.Labels ?? null, owner);
      if (
        (result.Config?.Labels ?? result.Labels)?.[
          "com.docker.compose.project"
        ] !== r.project
      )
        throw new Error();
      return result;
    } catch {
      throw new Error(
        "Task resource identity or ownership mismatch; cleanup refused.",
      );
    }
  }
  let containerId: string | undefined;
  let networkId: string | undefined;
  let volumeCreatedAt: string | undefined;
  async function captureIdentities() {
    const results = await Promise.allSettled([
      (async () => {
        const container = await inspect("container", r.container);
        if (!container.Id) throw new Error();
        containerId = container.Id;
      })(),
      (async () => {
        const network = await inspect("network", r.network);
        if (!network.Id) throw new Error();
        networkId = network.Id;
      })(),
      (async () => {
        const volume = await inspect("volume", r.volume);
        if (!volume.CreatedAt || volume.Name !== r.volume) throw new Error();
        volumeCreatedAt = volume.CreatedAt;
      })(),
    ]);
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Incomplete task resource identities; review required.");
  }
  async function confirmOwnership() {
    const container = await inspect("container", r.container);
    const network = await inspect("network", r.network);
    const volume = await inspect("volume", r.volume);
    const bindings = container.HostConfig?.PortBindings["5432/tcp"];
    if (
      !container.Id ||
      !network.Id ||
      !volume.CreatedAt ||
      volume.Name !== r.volume ||
      !network.Containers ||
      Object.keys(network.Containers).length !== 1 ||
      !Object.hasOwn(network.Containers, container.Id ?? "missing") ||
      (volumeCreatedAt && volumeCreatedAt !== volume.CreatedAt) ||
      (containerId && containerId !== container.Id) ||
      (networkId && networkId !== network.Id) ||
      container.Config?.Image !== r.image ||
      container.Mounts?.filter(
        (m) =>
          m.Type === "volume" &&
          m.Name === r.volume &&
          m.Destination === "/var/lib/postgresql/data",
      ).length !== 1 ||
      bindings?.length !== 1 ||
      bindings[0]?.HostIp !== "127.0.0.1" ||
      bindings[0]?.HostPort !== String(r.port)
    )
      throw new Error("Disposable database identity mismatch; setup refused.");
    const mounted = lines(
      await docker([
        "ps",
        "-a",
        "--filter",
        `volume=${r.volume}`,
        "--format",
        "{{.ID}}",
      ]),
    );
    const project = lines(
      await docker([
        "ps",
        "-a",
        "--filter",
        `label=com.docker.compose.project=${r.project}`,
        "--format",
        "{{.ID}}",
      ]),
    );
    if (
      mounted.length !== 1 ||
      project.length !== 1 ||
      !container.Id.startsWith(mounted[0] ?? "missing") ||
      !container.Id.startsWith(project[0] ?? "missing")
    )
      throw new Error(
        "Unexpected container shares integration resources; cleanup refused.",
      );
  }
  async function cleanup() {
    const steps = createAuthCleanup();
    // Reverse acquisition order is container, network, volume. Each check is independent.
    steps.add(async () => {
      if (!volumeCreatedAt)
        throw new Error("Owned volume identity unavailable.");
      const volume = await inspect("volume", r.volume);
      if (volume.CreatedAt !== volumeCreatedAt)
        throw new Error("Owned volume identity changed.");
      if (
        (await docker([
          "ps",
          "-a",
          "--filter",
          `volume=${r.volume}`,
          "--format",
          "{{.ID}}",
        ])) !== ""
      )
        throw new Error("Integration volume is still in use; cleanup refused.");
      await docker(["volume", "rm", r.volume]);
    });
    steps.add(async () => {
      if (!networkId) throw new Error("Owned network identity unavailable.");
      const network = await inspect("network", networkId);
      if (
        network.Id !== networkId ||
        !network.Containers ||
        Object.keys(network.Containers).length !== 0
      )
        throw new Error("Owned network changed or is in use.");
      await docker(["network", "rm", networkId]);
    });
    steps.add(async () => {
      if (!containerId)
        throw new Error("Owned container identity unavailable.");
      await confirmOwnership();
      await docker(["rm", "--force", containerId]);
    });
    await steps.stop();
  }
  try {
    await docker([
      "compose",
      "--project-name",
      r.project,
      "--file",
      composeFile,
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      "60",
    ]);
    await captureIdentities();
    await confirmOwnership();
  } catch {
    // Only this invocation's unique lease may be captured after partial Compose creation.
    if (!containerId && !networkId && !volumeCreatedAt) {
      try {
        await captureIdentities();
      } catch {
        /* Missing/foreign identities remain uncaptured. */
      }
    }
    try {
      await cleanup();
    } catch {
      /* Explicit manual ownership review required. */
    }
    throw new Error(
      "Disposable resource setup failed; review lease-specific leftovers.",
    );
  }
  return { resources: r, username, password, confirmOwnership, cleanup };
}

export async function createOwnedAuthDatabase(
  environment: Readonly<Record<string, string | undefined>>,
  command: AuthDockerCommand = executeDocker,
) {
  validateAuthIntegrationInvocation(environment);
  await requireFreeLoopbackPort(56221);
  const owned = await createOwnedAuthResources(environment, command);
  const { resources: r, username, password, confirmOwnership, cleanup } = owned;
  const teardown = createAuthCleanup();
  teardown.add(cleanup);
  try {
    const connectionString = `postgresql://${username}:${password}@127.0.0.1:${r.port}/${r.database}`;
    const guarded = loadTestDatabaseEnvironment({
      TEST_DATABASE_URL: connectionString,
    });
    const admin = new Client({
      connectionString: connectionString.replace(`/${r.database}`, "/postgres"),
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
    });
    let adminClosing: Promise<void> | undefined;
    const closeAdmin = () => (adminClosing ??= admin.end());
    teardown.add(closeAdmin);
    try {
      await admin.connect();
      const identity = await admin.query<{
        database: string;
        username: string;
        exists: boolean;
      }>(
        "SELECT current_database() AS database, current_user AS username, EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
        [r.database],
      );
      if (
        identity.rows[0]?.database !== "postgres" ||
        identity.rows[0]?.username !== username ||
        identity.rows[0]?.exists !== false
      )
        throw new Error("Disposable database was not newly owned.");
      const inventory = await admin.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname",
      );
      requireFreshDatabaseInventory(inventory.rows.map((row) => row.datname));
      await confirmOwnership();
      await provisionTestDatabase(guarded);
      const target = new Client({
        connectionString,
        connectionTimeoutMillis: 5_000,
        query_timeout: 5_000,
      });
      try {
        await target.connect();
        const rows = await target.query<{ database: string; username: string }>(
          "SELECT current_database() AS database, current_user AS username",
        );
        if (
          rows.rows[0]?.database !== r.database ||
          rows.rows[0]?.username !== username
        )
          throw new Error("Disposable database target identity mismatch.");
        const tables = await target.query(
          "SELECT 1 FROM pg_tables WHERE schemaname = 'public'",
        );
        if (tables.rows.length !== 0)
          throw new Error(
            "New disposable target contains unexpected tables; migrations refused.",
          );
      } finally {
        await authBounded(target.end());
      }
      await confirmOwnership();
      await applyTestDatabaseMigrations(guarded);
    } catch {
      throw new Error("Disposable database setup failed; details withheld.");
    } finally {
      await authBounded(closeAdmin());
    }
    return { environment: guarded, cleanup };
  } catch {
    try {
      await teardown.stop();
    } catch {
      /* Ambiguous leftovers require manual review. */
    }
    throw new Error(
      "Disposable database setup failed; review owned resources.",
    );
  }
}
