import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_INTEGRATION_APPROVAL,
  authIntegrationResources,
  createOwnedAuthDatabase,
  createOwnedAuthResources,
  type AuthDockerCommand,
} from "./auth-integration-database.ts";
import {
  applyTestDatabaseMigrations,
  provisionTestDatabase,
} from "./database-harness.ts";

const database = vi.hoisted(() => ({
  fail: "",
  opened: [] as string[],
  closed: [] as string[],
}));
vi.mock("pg", () => ({
  Client: class {
    private target: string;
    private username: string;
    constructor({ connectionString }: { connectionString: string }) {
      const url = new URL(connectionString);
      this.target = url.pathname.slice(1);
      this.username = url.username;
      if (database.fail === "constructor")
        throw new Error("Synthetic private database error");
    }
    async connect() {
      database.opened.push(this.target);
      if (
        database.fail ===
        `${this.target === "postgres" ? "admin" : "target"}-connect`
      )
        throw new Error("Synthetic private database error");
    }
    async query(sql: string) {
      if (database.fail === "inventory" && sql.includes("NOT datistemplate"))
        return { rows: [{ datname: "foreign" }] };
      if (sql.includes("NOT datistemplate"))
        return { rows: [{ datname: "postgres" }] };
      if (sql.includes("pg_tables"))
        return {
          rows: database.fail === "tables" ? [{ table: "unexpected" }] : [],
        };
      if (sql.includes("current_database"))
        return {
          rows: [
            {
              database: database.fail === "identity" ? "foreign" : this.target,
              username: this.username,
              exists: false,
            },
          ],
        };
      throw new Error("Unexpected mocked query");
    }
    async end() {
      database.closed.push(this.target);
      if (database.fail === "close")
        throw new Error("Synthetic private disconnect error");
    }
  },
}));

vi.mock("./database-harness.ts", () => ({
  applyTestDatabaseMigrations: vi.fn(),
  provisionTestDatabase: vi.fn(),
}));
const approved = {
  STOCKWISE_T02A_INTEGRATION_AUTHORIZE: AUTH_INTEGRATION_APPROVAL,
};

// An in-memory Docker inventory; no Docker executable, engine, socket, or database.
function engine() {
  const inventory = new Map<
    string,
    { kind: string; value: Record<string, unknown> }
  >();
  const calls: string[][] = [];
  let createFailure: "none" | "volume" | "all" = "none";
  let preexisting = false;
  let conflictingCreation = false;
  let failingRemoval: string | undefined;
  const command: AuthDockerCommand = async (args, env) => {
    calls.push([...args]);
    const r = authIntegrationResources(env.STOCKWISE_T02A_OWNER!);
    if (args[0] === "context") return "npipe:////./pipe/docker_engine";
    if (args[0] === "compose") {
      const labels = {
        "stockwise.t02a.owner": env.STOCKWISE_T02A_OWNER!,
        "com.docker.compose.project": r.project,
      };
      inventory.set(r.volume, {
        kind: "volume",
        value: { Name: r.volume, CreatedAt: randomUUID(), Labels: labels },
      });
      if (createFailure !== "volume") {
        const id = randomUUID().replaceAll("-", "");
        inventory.set(r.network, {
          kind: "network",
          value: {
            Id: randomUUID(),
            Name: r.network,
            Labels: labels,
            Containers: { [id]: {} },
          },
        });
        inventory.set(r.container, {
          kind: "container",
          value: {
            Id: id,
            Name: r.container,
            Config: { Image: r.image, Labels: labels },
            Mounts: [
              {
                Type: "volume",
                Name: r.volume,
                Destination: "/var/lib/postgresql/data",
              },
            ],
            HostConfig: {
              PortBindings: {
                "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: String(r.port) }],
              },
            },
          },
        });
      }
      if (createFailure !== "none")
        throw new Error("Synthetic Compose failure");
      if (conflictingCreation) {
        for (const item of inventory.values()) {
          const labels =
            item.kind === "container"
              ? (item.value.Config as { Labels: Record<string, string> }).Labels
              : (item.value.Labels as Record<string, string>);
          labels["stockwise.t02a.owner"] = randomUUID();
        }
      }
      return "";
    }
    if (args[1] === "inspect") {
      const entry = [...inventory.entries()].find(
        ([key, item]) =>
          item.kind === args[0] &&
          (key === args[2] || item.value.Id === args[2]),
      );
      if (!entry) throw new Error("Synthetic missing resource");
      return JSON.stringify([entry[1].value]);
    }
    if (args.includes("--format")) {
      const kind = args[0] === "ps" ? "container" : args[0];
      if (preexisting && args[0] === "ps" && !args.includes("--filter"))
        return r.container;
      const filter = args[args.indexOf("--filter") + 1];
      const entries = [...inventory.entries()].filter(
        ([, item]) => item.kind === kind,
      );
      const filtered = !args.includes("--filter")
        ? entries
        : entries.filter(([, item]) => {
            if (filter?.startsWith("volume="))
              return (
                item.value.Name ===
                filter
                  .replace("volume=", "")
                  .replace("-postgres-data", "-postgres")
              );
            const labels =
              item.kind === "container"
                ? (item.value.Config as { Labels: Record<string, string> })
                    .Labels
                : (item.value.Labels as Record<string, string>);
            return (
              labels["com.docker.compose.project"] === filter?.split("=").at(-1)
            );
          });
      return filtered
        .map(([name, item]) =>
          args.at(-1) === "{{.ID}}" ? String(item.value.Id) : name,
        )
        .join("\n");
    }
    if (args[0] === "rm" || args[1] === "rm") {
      const target = args.at(-1)!;
      const entry = [...inventory.entries()].find(
        ([name, item]) => name === target || item.value.Id === target,
      );
      if (!entry || entry[1].kind === failingRemoval)
        throw new Error("Synthetic removal failure");
      if (entry[1].kind === "container") {
        for (const item of inventory.values())
          if (item.kind === "network")
            delete (item.value.Containers as Record<string, unknown>)[
              String(entry[1].value.Id)
            ];
      }
      inventory.delete(entry[0]);
      return "";
    }
    throw new Error("Unexpected mocked Docker command");
  };
  return {
    inventory,
    calls,
    command,
    partial(value: typeof createFailure) {
      createFailure = value;
    },
    unexpected() {
      preexisting = true;
    },
    conflicting() {
      conflictingCreation = true;
    },
    failRemoval(kind: string) {
      failingRemoval = kind;
    },
  };
}

describe("lease-specific Docker orchestration without Docker", () => {
  it("isolates two simultaneous invocations even after both pass absence checks", async () => {
    const mock = engine();
    const bothInventoried = Promise.withResolvers<void>();
    let waitingCreators = 0;
    const command: AuthDockerCommand = async (args, environment) => {
      if (args[0] === "compose") {
        waitingCreators += 1;
        if (waitingCreators === 2) bothInventoried.resolve();
        await bothInventoried.promise;
      }
      return mock.command(args, environment);
    };
    const [a, b] = await Promise.all([
      createOwnedAuthResources(approved, command),
      createOwnedAuthResources(approved, command),
    ]);
    expect(waitingCreators).toBe(2);
    expect(a.resources.project).not.toBe(b.resources.project);
    for (const key of ["container", "network", "volume"] as const)
      expect(a.resources[key]).not.toBe(b.resources[key]);
    expect(mock.inventory.size).toBe(6);
    await a.cleanup();
    expect(mock.inventory.has(b.resources.container)).toBe(true);
    expect(mock.inventory.has(b.resources.volume)).toBe(true);
    await b.confirmOwnership();
    await b.cleanup();
    expect(mock.inventory.size).toBe(0);
  });
  it("refuses unexpected existing names before any creation or removal", async () => {
    const mock = engine();
    mock.unexpected();
    await expect(
      createOwnedAuthResources(approved, mock.command),
    ).rejects.toThrow("already exist");
    expect(
      mock.calls.some((args) => args[0] === "compose" || args.includes("rm")),
    ).toBe(false);
  });
  it("refuses conflicting ownership at acquisition without removing any foreign resource", async () => {
    const mock = engine();
    mock.conflicting();
    await expect(
      createOwnedAuthResources(approved, mock.command),
    ).rejects.toThrow("setup failed");
    expect(mock.inventory.size).toBe(3);
    expect(mock.calls.some((args) => args.includes("rm"))).toBe(false);
  });
  it("cleans positively owned storage after partial creation and permits a fresh retry", async () => {
    const mock = engine();
    mock.partial("volume");
    await expect(
      createOwnedAuthResources(approved, mock.command),
    ).rejects.toThrow("setup failed");
    expect(mock.inventory.size).toBe(0);
    mock.partial("none");
    const retry = await createOwnedAuthResources(approved, mock.command);
    expect(
      new Set(
        mock.calls
          .filter((args) => args[0] === "compose")
          .map((args) => args[2]),
      ).size,
    ).toBe(2);
    await retry.cleanup();
  });
  it("captures and cleans a complete creation when Compose reports failure", async () => {
    const mock = engine();
    mock.partial("all");
    await expect(
      createOwnedAuthResources(approved, mock.command),
    ).rejects.toThrow("setup failed");
    expect(mock.inventory.size).toBe(0);
  });
  for (const kind of ["container", "network", "volume"] as const) {
    it(`refuses deletion after ${kind} ownership changes`, async () => {
      const mock = engine();
      const owned = await createOwnedAuthResources(approved, mock.command);
      const resource = mock.inventory.get(owned.resources[kind])!;
      const labels =
        kind === "container"
          ? (resource.value.Config as { Labels: Record<string, string> }).Labels
          : (resource.value.Labels as Record<string, string>);
      labels["stockwise.t02a.owner"] = randomUUID();
      await expect(owned.cleanup()).rejects.toThrow("cleanup incomplete");
      expect(mock.inventory.has(owned.resources[kind])).toBe(true);
      expect(
        mock.calls.some(
          (args) =>
            args.includes("rm") &&
            [owned.resources[kind], resource.value.Id].includes(args.at(-1)),
        ),
      ).toBe(false);
    });
    it(`refuses deletion after ${kind} identity changes`, async () => {
      const mock = engine();
      const owned = await createOwnedAuthResources(approved, mock.command);
      const resource = mock.inventory.get(owned.resources[kind])!;
      if (kind === "volume") resource.value.CreatedAt = randomUUID();
      else resource.value.Id = randomUUID();
      await expect(owned.cleanup()).rejects.toThrow("cleanup incomplete");
      expect(mock.inventory.has(owned.resources[kind])).toBe(true);
    });
  }
  it("attempts independent volume cleanup when network removal fails", async () => {
    const mock = engine();
    const owned = await createOwnedAuthResources(approved, mock.command);
    mock.failRemoval("network");
    await expect(owned.cleanup()).rejects.toThrow("cleanup incomplete");
    expect(mock.inventory.has(owned.resources.container)).toBe(false);
    expect(mock.inventory.has(owned.resources.volume)).toBe(false);
    expect(mock.inventory.has(owned.resources.network)).toBe(true);
  });
  it("retains resources shared by a foreign container", async () => {
    const mock = engine();
    const owned = await createOwnedAuthResources(approved, mock.command);
    const container = mock.inventory.get(owned.resources.container)!;
    mock.inventory.set("foreign", {
      kind: "container",
      value: {
        ...container.value,
        Id: "foreign",
        Config: {
          Image: "other",
          Labels: { "com.docker.compose.project": "foreign" },
        },
      },
    });
    (
      mock.inventory.get(owned.resources.network)!.value.Containers as Record<
        string,
        unknown
      >
    ).foreign = {};
    await expect(owned.cleanup()).rejects.toThrow("cleanup incomplete");
    expect(mock.inventory.has("foreign")).toBe(true);
    expect(mock.inventory.has(owned.resources.volume)).toBe(true);
    expect(mock.calls.some((args) => args.includes("rm"))).toBe(false);
  });
});

describe("owned database setup fault injection without database connections", () => {
  beforeEach(() => {
    database.fail = "";
    database.opened = [];
    database.closed = [];
    vi.mocked(applyTestDatabaseMigrations).mockReset();
    vi.mocked(provisionTestDatabase).mockReset();
  });
  for (const stage of [
    "constructor",
    "admin-connect",
    "identity",
    "inventory",
    "target-connect",
    "tables",
    "close",
    "provision",
    "migration",
  ])
    it(`attempts ownership-checked resource cleanup after ${stage} fails`, async () => {
      database.fail = stage;
      if (stage === "migration")
        vi.mocked(applyTestDatabaseMigrations).mockRejectedValue(
          new Error("Synthetic private migration error"),
        );
      if (stage === "provision")
        vi.mocked(provisionTestDatabase).mockRejectedValue(
          new Error("Synthetic private provision error"),
        );
      const mock = engine();
      await expect(
        createOwnedAuthDatabase(approved, mock.command),
      ).rejects.toThrow(
        "Disposable database setup failed; review owned resources.",
      );
      expect(mock.inventory.size).toBe(0);
      if (database.opened.includes("postgres"))
        expect(database.closed).toContain("postgres");
      if (database.opened.includes("stockwise_t02a_auth_test"))
        expect(database.closed).toContain("stockwise_t02a_auth_test");
    });
});
