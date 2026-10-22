import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  assertWindowsLeasePass,
  execFileDockerTransport,
  WindowsDockerLease,
  WINDOWS_DOCKER_ENDPOINT,
  type DockerCommandResult,
  type DockerCommandTransport,
  type OperatorGrant,
  type WindowsResourceOptions,
} from "./windows-resources.mts";
import { createDockerCliFixture } from "./windows-docker-cli.fixture.mts";
import { windowsDockerCliBinding } from "./windows-docker-cli.mts";

const owner = "11111111-1111-4111-8111-111111111111";
const daemon = "22222222-2222-4222-8222-222222222222";
const source = "a".repeat(64),
  image = `postgres:16.15-alpine@sha256:${"b".repeat(64)}`;
const resolvedImageId = `sha256:${"e".repeat(64)}`;
const containerId = "c".repeat(64),
  networkId = "d".repeat(64),
  foreignId = "f".repeat(64);
const now = 1000000;
type ObjectRecord = Record<string, unknown>;
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value)!;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical((value as ObjectRecord)[key])}`,
    )
    .join(",")}}`;
}
const pin = (payload: unknown) =>
  createHash("sha256").update(canonical(payload)).digest("hex");
const ok = (stdout = ""): DockerCommandResult => ({
  stdout,
  stderr: "",
  code: 0,
  signal: null,
  timedOut: false,
});
const missing = (id: string): DockerCommandResult => ({
  ...ok(),
  code: 1,
  stderr: `Error: No such object: ${id}`,
});
const baseGrant = (operation: string, directory = "") => ({
  operation,
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
const grant = (contract: "G3-C" | "G3-D", payload: unknown): OperatorGrant => ({
  contract,
  digestInput: payload,
});
const dockerCliFixtures = new Map<
  string,
  ReturnType<typeof createDockerCliFixture>["approval"]
>();
async function sandbox(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "stockwise-d5-lease-"));
  try {
    await run(directory);
  } finally {
    dockerCliFixtures.delete(directory);
    await rm(directory, { recursive: true, force: true });
  }
}
function options(
  directory: string,
  transport: DockerCommandTransport,
  changes: Partial<WindowsResourceOptions> = {},
): WindowsResourceOptions {
  const payload = {
    ...baseGrant("acquire", directory),
    image: changes.image ?? image,
    resolvedImageId: changes.resolvedImageId ?? resolvedImageId,
  };
  let dockerCli = dockerCliFixtures.get(directory);
  if (!dockerCli) {
    dockerCli = createDockerCliFixture(directory).approval;
    dockerCliFixtures.set(directory, dockerCli);
  }
  return {
    leaseId: owner,
    journalDirectory: directory,
    environment: {},
    sourceSha256: source,
    migrationSha256: source,
    expectedSourceSha256: source,
    expectedMigrationSha256: source,
    g3c: grant("G3-C", payload),
    reviewPins: { g3cSha256: pin(payload) },
    endpoint: WINDOWS_DOCKER_ENDPOINT,
    operator: "operator",
    daemonId: daemon,
    image,
    resolvedImageId,
    dockerCli,
    transport,
    now: () => now,
    ...changes,
  };
}
function scoped(lease: WindowsDockerLease, operation: "cleanup" | "bootstrap") {
  const value = lease.lease;
  return {
    ...baseGrant(operation, value.journalDirectory),
    runId: value.runId,
    resources: {
      token: value.token,
      containerId: value.containerId,
      containerName: value.containerName,
      networkId: value.networkId,
      networkName: value.networkName,
      volumeName: value.volumeName,
      volumeBirth: value.volumeBirth,
    },
    ...(operation === "cleanup"
      ? {
          actions: [
            "stop-5s-then-force",
            "remove-container",
            "remove-network",
            "remove-volume",
          ],
          exclusiveWindow: "operator-prevents-concurrent-lease-mutation",
          volumeRace: "accept-non-atomic-volume-name-deletion",
        }
      : {}),
  };
}
function fakeDocker(imageReference = image) {
  const state = {
    objects: new Map<string, ObjectRecord>(),
    labels: new Map<string, Record<string, string>>(),
    calls: [] as string[][],
    imageInspect: {
      Id: resolvedImageId,
      Os: "linux",
      Architecture: "amd64",
      RepoTags: ["postgres:16.15-alpine"],
      RepoDigests: [`postgres@${imageReference.split("@")[1]}`],
      Config: { Env: ["PG_MAJOR=16", "PG_VERSION=16.15"] },
    } as ObjectRecord,
    lost: null as "volume" | "network" | "container" | null,
    delayed: false,
    inventoriesAfterLoss: 0,
    drift: false,
    foreignAttachment: false,
    foreignNetworkMember: false,
    replaceVolume: false,
    renameContainer: false,
    missingAbsenceReceipt: false,
    retainVolumeAfterDelete: false,
    readiness: 0,
    bootstrapPublicTables: 0,
    started: false,
    driftAfterNetworkCreate: false,
    unknownContainerId: false,
    replaceVolumeAtDelete: false,
    stopFailure: false,
  };
  const labelsFor = (args: readonly string[]) => {
    const labels: Record<string, string> = {};
    args.forEach((part, index) => {
      if (part === "--label") {
        const pair = args[index + 1]!.split("=");
        labels[pair[0]!] = pair.slice(1).join("=");
      }
    });
    return labels;
  };
  const transport: DockerCommandTransport = async (
    _executable,
    argv,
    commandOptions,
  ) => {
    assert.deepEqual(argv.slice(0, 2), ["--host", WINDOWS_DOCKER_ENDPOINT]);
    assert.equal(commandOptions.timeoutMs, 30000);
    const args = argv.slice(2);
    state.calls.push([...args]);
    if (args[0] === "info") return ok(state.drift ? "foreign-daemon" : daemon);
    if (args[0] === "image") {
      assert.deepEqual(args, ["image", "inspect", imageReference]);
      return ok(JSON.stringify([state.imageInspect]));
    }
    const createKind =
      args[0] === "create"
        ? "container"
        : args[1] === "create"
          ? args[0]
          : null;
    if (
      createKind === "container" ||
      createKind === "network" ||
      createKind === "volume"
    ) {
      const name =
        createKind === "container"
          ? args[args.indexOf("--name") + 1]!
          : args.at(-1)!;
      const id =
        createKind === "container"
          ? containerId
          : createKind === "network"
            ? networkId
            : name;
      const labels = labelsFor(args);
      state.labels.set(createKind, labels);
      const record: ObjectRecord =
        createKind === "volume"
          ? {
              Name: name,
              CreatedAt: "2026-10-17T00:00:00Z",
              Driver: "local",
              Options: null,
              Labels: labels,
            }
          : createKind === "network"
            ? {
                Id: id,
                Name: name,
                Internal: true,
                Driver: "bridge",
                Labels: labels,
                Containers: {},
              }
            : {
                Id: id,
                Name: `/${name}`,
                Image: resolvedImageId,
                Config: { Image: args.at(-1), Labels: labels },
                HostConfig: {
                  Privileged: false,
                  PortBindings: {},
                  Binds: [],
                  NetworkMode: networkId,
                },
                Mounts: [
                  {
                    Type: "volume",
                    Name: [...state.objects.values()].find(
                      (item) => item.Driver === "local",
                    )!.Name,
                    Destination: "/var/lib/postgresql/data",
                    RW: true,
                  },
                ],
                NetworkSettings: {
                  Networks: {
                    [String(state.objects.get(networkId)!.Name)]: {
                      NetworkID: networkId,
                    },
                  },
                },
              };
      state.objects.set(id, record);
      if (createKind === "container") {
        assert.ok(commandOptions.credentials?.POSTGRES_PASSWORD);
        assert.equal(
          args.some((arg) =>
            arg.includes(commandOptions.credentials!.POSTGRES_PASSWORD!),
          ),
          false,
        );
      }
      if (state.lost === createKind)
        return { ...ok(), code: null, timedOut: true };
      if (state.driftAfterNetworkCreate && createKind === "network")
        state.drift = true;
      if (state.unknownContainerId && createKind === "container") return ok();
      return ok(id);
    }
    if (args[0] === "ps" || args[1] === "ls") {
      const kind = args[0] === "ps" ? "container" : args[0];
      const filter = args.includes("--filter")
        ? args[args.indexOf("--filter") + 1]!
        : null;
      if (filter?.startsWith("volume="))
        return ok(
          [
            ...(state.objects.has(containerId) ? [containerId] : []),
            ...(state.foreignAttachment ? [foreignId] : []),
          ].join("\n"),
        );
      if (state.lost && state.delayed && ++state.inventoriesAfterLoss <= 3)
        return ok();
      const rows: string[] = [];
      for (const [id, value] of state.objects) {
        const labels = (value.Labels ??
          (value.Config as ObjectRecord | undefined)?.Labels) as Record<
          string,
          string
        >;
        if (!labels || labels["stockwise.d5.role"] !== kind) continue;
        if (filter?.startsWith("label=")) {
          const [key, label] = filter.slice(6).split("=");
          if (labels[key!] !== label) continue;
        }
        const name = String(value.Name).replace(/^\//, "");
        rows.push(kind === "volume" ? name : `${id}|${name}`);
      }
      return ok(rows.join("\n"));
    }
    if (args[1] === "inspect") {
      const target = args[2]!;
      const value = state.objects.get(target);
      if (!value)
        return state.missingAbsenceReceipt
          ? { ...missing(target), stderr: "permission denied" }
          : missing(target);
      const copy = structuredClone(value);
      if (args[0] === "volume" && state.replaceVolume)
        copy.CreatedAt = "replacement-birth";
      if (args[0] === "network" && state.foreignNetworkMember)
        copy.Containers = { [foreignId]: {} };
      if (args[0] === "container" && state.renameContainer)
        copy.Name = "/renamed";
      return ok(JSON.stringify([copy]));
    }
    if (args[0] === "stop") {
      if (state.stopFailure)
        return { ...ok(), code: 7, stderr: "synthetic-stop-failure" };
      state.started = false;
      state.objects.get(networkId)!.Containers = {};
      return ok();
    }
    if (args[1] === "rm") {
      if (!(args[0] === "volume" && state.retainVolumeAfterDelete))
        state.objects.delete(args[2]!);
      if (args[0] === "network" && state.replaceVolumeAtDelete)
        state.replaceVolume = true;
      return ok();
    }
    if (args[0] === "start") {
      state.started = true;
      state.objects.get(networkId)!.Containers = { [containerId]: {} };
      return ok();
    }
    if (args[0] === "exec" && args.includes("pg_isready")) {
      return state.readiness++ === 0 ? { ...ok(), code: 1 } : ok();
    }
    if (args[0] === "exec" && args.includes("psql")) {
      assert.ok(commandOptions.credentials?.PGPASSWORD);
      if (commandOptions.stdin) {
        assert.match(commandOptions.stdin, /^CREATE ROLE stockwise_d5_/);
        assert.equal(
          /migration|truncate|DROP|seed/i.test(commandOptions.stdin),
          false,
        );
        return ok();
      }
      const database = args[args.indexOf("-d") + 1]!,
        user = args[args.indexOf("-U") + 1]!;
      return ok(
        JSON.stringify(
          database === "postgres"
            ? {
                database,
                user,
                databases: ["postgres"],
                publicTables: state.bootstrapPublicTables,
                cluster: "123456",
              }
            : {
                database,
                user,
                publicTables: 0,
                address: "127.0.0.1",
                port: 5432,
              },
        ),
      );
    }
    throw new Error(`Unexpected fake command: ${args[0]} ${args[1]}`);
  };
  return { state, transport };
}

const cleanup = (
  lease: WindowsDockerLease,
  payload = scoped(lease, "cleanup"),
) => lease.cleanup(grant("G3-D", payload), { g3dSha256: pin(payload) });

test("original unsafe environment, endpoint substitution and unreviewed grant fail before Docker", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    await assert.rejects(
      WindowsDockerLease.acquire(
        options(directory, fake.transport, {
          environment: { dAtAbAsE_uRl: "postgresql://foreign.invalid/never" },
        }),
      ),
      /WINDOWS_CALLER_ENVIRONMENT_UNSAFE/,
    );
    await assert.rejects(
      WindowsDockerLease.acquire(
        options(directory, fake.transport, {
          endpoint: "tcp://foreign.invalid",
        }),
      ),
      /WINDOWS_RESOURCE_CONFIGURATION_INVALID/,
    );
    await assert.rejects(
      WindowsDockerLease.acquire(
        options(directory, fake.transport, {
          reviewPins: { g3cSha256: source },
        }),
      ),
      /AUTHORIZATION_PIN_MISMATCH/,
    );
    assert.deepEqual(fake.state.calls, []);
  }));

for (const reference of [
  image,
  `postgres@sha256:${"b".repeat(64)}`,
  `postgres@${resolvedImageId}`,
]) {
  test(`approved immutable PostgreSQL reference acquires exact image without pull: ${reference}`, async () =>
    sandbox(async (directory) => {
      const fake = fakeDocker(reference);
      const lease = await WindowsDockerLease.acquire(
        options(directory, fake.transport, { image: reference }),
      );
      try {
        assert.equal(lease.lease.status, "ACQUIRED");
        assert.equal(lease.lease.failureCount, 0);
        const create = fake.state.calls.find((args) => args[0] === "create");
        assert.ok(create);
        assert.equal(create.at(-1), reference);
        assert.ok(create.includes("--pull=never"));
        assert.equal(
          fake.state.objects.get(containerId)?.Image,
          resolvedImageId,
        );
        assert.equal(
          fake.state.calls.some((args) =>
            ["pull", "start", "exec"].includes(args[0]!),
          ),
          false,
        );
      } finally {
        await lease.closeSupervisor();
      }
    }));
}

test("mutable, foreign, malformed and non-16-Alpine image references dispatch nothing", async () => {
  for (const reference of [
    "postgres:16.15-alpine",
    resolvedImageId,
    `foreign/postgres@${resolvedImageId}`,
    `postgres.evil@${resolvedImageId}`,
    `postgres:17.1-alpine@${resolvedImageId}`,
    `postgres:16.15-bookworm@${resolvedImageId}`,
    `postgres@${resolvedImageId.toUpperCase()}`,
    `postgres@${resolvedImageId}\n`,
    `postgres@sha256:${"b".repeat(63)}`,
  ]) {
    await sandbox(async (directory) => {
      const fake = fakeDocker(reference);
      await assert.rejects(
        WindowsDockerLease.acquire(
          options(directory, fake.transport, { image: reference }),
        ),
        /WINDOWS_RESOURCE_CONFIGURATION_INVALID/,
      );
      assert.deepEqual(fake.state.calls, []);
    });
  }
});

test("digest-only image binding cannot bypass absent, mismatched or stale approval", async () => {
  const reference = `postgres@${resolvedImageId}`;
  for (const approval of ["absent", "wrong-pin", "old-reference", "old-id"]) {
    await sandbox(async (directory) => {
      const fake = fakeDocker(reference);
      const input = options(directory, fake.transport, { image: reference });
      const mismatched = {
        ...baseGrant("acquire", directory),
        image: approval === "old-reference" ? image : reference,
        resolvedImageId:
          approval === "old-id" ? `sha256:${foreignId}` : resolvedImageId,
      };
      await assert.rejects(
        WindowsDockerLease.acquire({
          ...input,
          ...(approval === "absent"
            ? { g3c: null }
            : approval === "wrong-pin"
              ? { reviewPins: { g3cSha256: source } }
              : {
                  g3c: grant("G3-C", mismatched),
                  reviewPins: { g3cSha256: pin(mismatched) },
                }),
        }),
        /OPERATOR_AUTHORIZATION_/,
      );
      assert.deepEqual(fake.state.calls, []);
    });
  }
});

const invalidImages: readonly [string, ObjectRecord][] = [
  ["actual ID mismatch", { Id: `sha256:${foreignId}` }],
  ["foreign OS", { Os: "windows" }],
  ["wrong architecture", { Architecture: "arm64" }],
  ["missing platform", { Os: undefined }],
  [
    "foreign repository digest",
    { RepoDigests: [`foreign/postgres@${resolvedImageId}`] },
  ],
  ["digest mismatch", { RepoDigests: [`postgres@sha256:${foreignId}`] }],
  ["missing repository digest", { RepoDigests: [] }],
  ["malformed repository digests", { RepoDigests: [null] }],
  [
    "nonarray repository digests",
    { RepoDigests: `postgres@${resolvedImageId}` },
  ],
  ["non-Alpine tag", { RepoTags: ["postgres:16.15-bookworm"] }],
  ["foreign repository tag", { RepoTags: ["foreign/postgres:16.15-alpine"] }],
  ["wrong major tag", { RepoTags: ["postgres:17.1-alpine"] }],
  ["malformed tags", { RepoTags: [16] }],
  ["missing tags", { RepoTags: undefined }],
  ["spoofed 16 tag", { Config: { Env: ["PG_MAJOR=17", "PG_VERSION=17.1"] } }],
  [
    "wrong major metadata",
    { Config: { Env: ["PG_MAJOR=17", "PG_VERSION=16.15"] } },
  ],
  [
    "spoofed minor tag",
    { Config: { Env: ["PG_MAJOR=16", "PG_VERSION=16.14"] } },
  ],
  [
    "ambiguous major",
    { Config: { Env: ["PG_MAJOR=16", "PG_MAJOR=17", "PG_VERSION=16.15"] } },
  ],
  [
    "ambiguous version",
    { Config: { Env: ["PG_MAJOR=16", "PG_VERSION=16.15", "PG_VERSION=17.1"] } },
  ],
  [
    "malformed version",
    { Config: { Env: ["PG_MAJOR=16", "PG_VERSION=16.15-spoof"] } },
  ],
  ["missing version metadata", { Config: { Env: ["PG_MAJOR=16"] } }],
  ["malformed environment", { Config: { Env: [16] } }],
  ["missing configuration", { Config: null }],
];
for (const [name, metadata] of invalidImages) {
  test(`invalid inspected PostgreSQL image prevents every resource create: ${name}`, async () =>
    sandbox(async (directory) => {
      const reference = `postgres@${resolvedImageId}`;
      const fake = fakeDocker(reference);
      Object.assign(fake.state.imageInspect, metadata);
      const lease = await WindowsDockerLease.acquire(
        options(directory, fake.transport, { image: reference }),
      );
      try {
        assert.equal(lease.lease.status, "INCOMPLETE");
        assert.equal(lease.lease.verdict, "FAIL");
        assert.ok(
          lease.lease.failures.some(
            (failure) => failure.category === "ACQUISITION",
          ),
        );
        assert.equal(
          fake.state.calls.some((args) => args.includes("create")),
          false,
        );
        assert.equal(fake.state.objects.size, 0);
      } finally {
        await lease.closeSupervisor();
      }
    }));
}

test("tagged digest must match inspected PostgreSQL minor even if another valid 16-Alpine tag exists", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    fake.state.imageInspect.RepoTags = [
      "postgres:16.14-alpine",
      "postgres:16.15-alpine",
    ];
    fake.state.imageInspect.Config = {
      Env: ["PG_MAJOR=16", "PG_VERSION=16.14"],
    };
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    try {
      assert.equal(lease.lease.status, "INCOMPLETE");
      assert.equal(
        fake.state.calls.some((args) => args.includes("create")),
        false,
      );
    } finally {
      await lease.closeSupervisor();
    }
  }));

test("daemon drift blocks creation and preserves an incomplete lease", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    fake.state.drift = true;
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    assert.equal(lease.lease.status, "INCOMPLETE");
    assert.equal(fake.state.objects.size, 0);
    assert.throws(
      () => assertWindowsLeasePass(lease.lease),
      /WINDOWS_LEASE_NOT_PASS/,
    );
  }));

test("same-lease acquisition and concurrent methods cannot share a supervisor", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    await assert.rejects(
      WindowsDockerLease.acquire(options(directory, fake.transport)),
      /EEXIST/,
    );
    const first = lease.reconcile();
    await assert.rejects(lease.reconcile(), /LEASE_OPERATION_CONFLICT/);
    await first;
  }));

test("resource acquisition never starts PostgreSQL or invokes migrations and missing G3-D cannot delete", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    assert.equal(lease.lease.status, "ACQUIRED");
    assert.equal(
      fake.state.calls.some((args) => ["start", "exec"].includes(args[0]!)),
      false,
    );
    assert.throws(
      () => lease.executeSchema(),
      /SCHEMA_EXECUTION_UNAVAILABLE_IN_R2/,
    );
    const count = fake.state.calls.length;
    assert.equal(
      (await lease.cleanup(null, { g3dSha256: source })).status,
      "INCOMPLETE",
    );
    assert.equal(fake.state.calls.length, count);
    assert.equal(fake.state.objects.has(containerId), true);
  }));

test("lost and delayed creation results remain uncertain even after empty or later visible inventories", async () => {
  for (const delayed of [false, true])
    await sandbox(async (directory) => {
      const fake = fakeDocker();
      fake.state.lost = "network";
      fake.state.delayed = delayed;
      const lease = await WindowsDockerLease.acquire(
        options(directory, fake.transport),
      );
      assert.equal(lease.lease.status, "UNCERTAIN");
      assert.equal((await lease.reconcile()).status, "UNCERTAIN");
      assert.equal(
        fake.state.calls.filter(
          (args) => args[0] === "network" && args[1] === "create",
        ).length,
        1,
      );
      assert.equal((await cleanup(lease)).status, "INCOMPLETE");
      assert.equal(fake.state.objects.has(networkId), true);
      const journal = await readFile(
        join(directory, owner, "journal.jsonl"),
        "utf8",
      );
      assert.match(journal, /CREATE_INTENT/);
      assert.match(journal, /PROCESS_FAILURE/);
      assert.match(journal, /RECONCILIATION/);
      assert.equal(journal.includes("POSTGRES_PASSWORD"), false);
    });
});

test("foreign preexisting names are rejected before any create", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const name = `sw-d5-${owner}-data`;
    fake.state.objects.set(name, {
      Name: name,
      Labels: {
        "stockwise.d5.role": "volume",
        "stockwise.d5.owner": "foreign",
      },
    });
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    assert.equal(lease.lease.status, "INCOMPLETE");
    assert.equal(
      fake.state.calls.some((args) => args.includes("create")),
      false,
    );
    assert.equal(fake.state.objects.has(name), true);
  }));

test("separately pinned exact G3-D removes owned resources and reconciles identities after deletion", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    assert.equal(lease.lease.status, "ACQUIRED");
    const result = await cleanup(lease);
    assert.equal(result.status, "CLEAN");
    assertWindowsLeasePass(result);
    assert.equal(fake.state.objects.has(containerId), false);
    const journal = await readFile(
      join(directory, owner, "journal.jsonl"),
      "utf8",
    );
    assert.equal(journal.split("ABSENCE_CONFIRMED").length - 1, 3);
  }));

test("ownership changes, foreign attachments, renamed IDs and volume replacement refuse destructive cleanup", async () => {
  for (const scenario of [
    "foreignAttachment",
    "foreignNetworkMember",
    "replaceVolume",
    "renameContainer",
    "ownerMismatch",
  ] as const)
    await sandbox(async (directory) => {
      const fake = fakeDocker();
      const lease = await WindowsDockerLease.acquire(
        options(directory, fake.transport),
      );
      if (scenario === "ownerMismatch")
        fake.state.labels.get("container")!["stockwise.d5.owner"] = "foreign";
      else fake.state[scenario] = true;
      const result = await cleanup(lease);
      assert.equal(result.status, "INCOMPLETE");
      assert.equal(fake.state.objects.has(containerId), true);
      assert.equal(
        fake.state.calls.some((args) => args[0] === "stop" || args[1] === "rm"),
        false,
      );
    });
});

test("missing race permission, wrong reviewed pin and exact identity substitutions never authorize cleanup", async () => {
  for (const scenario of [
    "noRace",
    "wrongPin",
    "wrongIdentity",
    "expired",
    "limit",
  ] as const)
    await sandbox(async (directory) => {
      const fake = fakeDocker();
      const lease = await WindowsDockerLease.acquire(
        options(directory, fake.transport),
      );
      const payload = scoped(lease, "cleanup");
      if (scenario === "noRace") payload.volumeRace = "retain-volume";
      if (scenario === "wrongIdentity")
        payload.resources.containerId = foreignId;
      if (scenario === "expired") payload.expiresAt = now;
      if (scenario === "limit") payload.maxCommands = 1;
      const result = await lease.cleanup(grant("G3-D", payload), {
        g3dSha256: scenario === "wrongPin" ? source : pin(payload),
      });
      assert.equal(result.status, "INCOMPLETE");
      assert.equal(fake.state.objects.has(containerId), true);
      assert.equal(
        fake.state.calls.some((args) => args[0] === "stop" || args[1] === "rm"),
        false,
      );
    });
});

test("missing absence receipts and surviving volumes keep cleanup incomplete", async () => {
  for (const scenario of [
    "missingAbsenceReceipt",
    "retainVolumeAfterDelete",
  ] as const)
    await sandbox(async (directory) => {
      const fake = fakeDocker();
      const lease = await WindowsDockerLease.acquire(
        options(directory, fake.transport),
      );
      fake.state[scenario] = true;
      const result = await cleanup(lease);
      assert.equal(result.status, "INCOMPLETE");
      assert.throws(
        () => assertWindowsLeasePass(result),
        /WINDOWS_LEASE_NOT_PASS/,
      );
    });
});

test("bootstrap needs a separate exact grant; only fresh-cluster bootstrap and allowlisted identity SQL are reachable", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    const payload = scoped(lease, "bootstrap");
    const result = await lease.bootstrap(grant("G3-C", payload), {
      g3cSha256: pin(payload),
    });
    assert.equal(result.clusterIdentity, "123456");
    assert.equal(
      result.database,
      `stockwise_d5_${owner.replaceAll("-", "")}_test`,
    );
    assert.equal(lease.lease.failureCount, 0);
    await assert.rejects(
      lease.bootstrap(grant("G3-C", payload), { g3cSha256: pin(payload) }),
      /BOOTSTRAP_INCOMPLETE/,
    );
  }));

test("acquisition grant cannot authorize bootstrap and nonfresh metadata blocks role creation", async () => {
  await sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    const payload = baseGrant("acquire");
    await assert.rejects(
      lease.bootstrap(grant("G3-C", payload), { g3cSha256: pin(payload) }),
      /BOOTSTRAP_INCOMPLETE/,
    );
    assert.equal(fake.state.started, false);
  });
  await sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    fake.state.bootstrapPublicTables = 1;
    const payload = scoped(lease, "bootstrap");
    await assert.rejects(
      lease.bootstrap(grant("G3-C", payload), { g3cSha256: pin(payload) }),
      /BOOTSTRAP_INCOMPLETE/,
    );
    assert.equal(
      fake.state.calls.filter((args) => args.includes("-f")).length,
      0,
    );
  });
});

test("daemon drift between create and inspect preserves returned identity but never authorizes later mutations", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    fake.state.driftAfterNetworkCreate = true;
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    assert.equal(lease.lease.status, "UNCERTAIN");
    assert.equal(lease.lease.networkId, networkId);
    assert.equal(fake.state.objects.has(containerId), false);
    assert.equal((await cleanup(lease)).status, "INCOMPLETE");
    assert.equal(
      fake.state.calls.some((args) => args[1] === "rm"),
      false,
    );
  }));

test("unknown container creation identity cannot be adopted from matching names or labels", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    fake.state.unknownContainerId = true;
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    assert.equal(lease.lease.status, "UNCERTAIN");
    assert.equal(lease.lease.containerId, null);
    assert.equal((await cleanup(lease)).status, "INCOMPLETE");
    assert.equal(fake.state.objects.has(containerId), true);
  }));

test("volume replacement in the final deletion window is retained, not name-deleted", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    fake.state.replaceVolumeAtDelete = true;
    assert.equal((await cleanup(lease)).status, "INCOMPLETE");
    assert.equal(fake.state.objects.has(containerId), false);
    assert.equal(
      fake.state.calls.some((args) => args[0] === "volume" && args[1] === "rm"),
      false,
    );
    assert.equal(fake.state.objects.has(lease.lease.volumeName), true);
  }));

test("destructive command failure preserves exit evidence and cannot become PASS", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    fake.state.stopFailure = true;
    const result = await cleanup(lease);
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(result.failureCount, 1);
    assert.equal(fake.state.objects.has(containerId), true);
    const journal = await readFile(
      join(directory, owner, "journal.jsonl"),
      "utf8",
    );
    const failure = journal
      .split("\n")
      .filter(Boolean)
      .map((row) => JSON.parse(row) as ObjectRecord)
      .find((row) => row.event === "PROCESS_FAILURE");
    assert.equal(failure?.exitCode, 7);
    assert.equal(journal.includes("synthetic-stop-failure"), false);
    assert.throws(
      () => assertWindowsLeasePass(result),
      /WINDOWS_LEASE_NOT_PASS/,
    );
  }));

test("real command adapter preserves Node-only process failure and timeout receipts without Docker", async () =>
  sandbox(async (directory) => {
    const commandOptions = {
      environment: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
      },
      timeoutMs: 3000,
      maxOutputBytes: 1024,
      dockerCli: createDockerCliFixture(directory, process.execPath).approval,
    };
    const failed = await execFileDockerTransport(
      process.execPath,
      ["-e", "process.exit(9)"],
      commandOptions,
    );
    assert.equal(failed.code, 9);
    assert.equal(failed.signal, null);
    assert.equal(failed.timedOut, false);
    const timedOut = await execFileDockerTransport(
      process.execPath,
      ["-e", "setTimeout(() => {}, 3000)"],
      { ...commandOptions, timeoutMs: 50 },
    );
    assert.equal(timedOut.timedOut, true);
    assert.equal(timedOut.code, null);
  }));

async function journalRows(directory: string): Promise<ObjectRecord[]> {
  return (await readFile(join(directory, owner, "journal.jsonl"), "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as ObjectRecord);
}
const reserved = (rows: ObjectRecord[], digest: string) =>
  rows.filter(
    (row) => row.event === "COMMAND_RESERVED" && row.grantDigest === digest,
  );

test("cleanup grant exhaustion is cumulative and the same reviewed grant cannot replenish commands", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    const payload = { ...scoped(lease, "cleanup"), maxCommands: 1 };
    const digest = pin(payload);
    const before = fake.state.calls.length;
    assert.equal((await cleanup(lease, payload)).status, "INCOMPLETE");
    assert.equal(fake.state.calls.length - before, 1);
    assert.equal((await cleanup(lease, payload)).status, "INCOMPLETE");
    assert.equal(fake.state.calls.length - before, 1);
    assert.equal(reserved(await journalRows(directory), digest).length, 1);
    assert.equal(lease.lease.failures.at(-1)?.code, "CLEANUP_GRANT_EXHAUSTED");
  }));

test("partially consumed cleanup authority has only its original remaining allowance and fresh authority retains failures", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    fake.state.foreignAttachment = true;
    const payload = { ...scoped(lease, "cleanup"), maxCommands: 20 };
    const digest = pin(payload);
    const before = fake.state.calls.length;
    await cleanup(lease, payload);
    const firstUsed = reserved(await journalRows(directory), digest).length;
    assert.ok(firstUsed > 0 && firstUsed < 20);
    await cleanup(lease, payload);
    assert.equal(fake.state.calls.length - before, 20);
    assert.equal(reserved(await journalRows(directory), digest).length, 20);
    await cleanup(lease, payload);
    assert.equal(fake.state.calls.length - before, 20);
    const failures = lease.lease.failures;
    fake.state.foreignAttachment = false;
    const result = await cleanup(lease, {
      ...scoped(lease, "cleanup"),
      maxCommands: 501,
    });
    assert.equal(result.status, "CLEAN");
    assert.deepEqual(result.failures, failures);
    assert.equal(result.verdict, "FAIL");
    assert.throws(
      () => assertWindowsLeasePass(result),
      /WINDOWS_LEASE_NOT_PASS/,
    );
  }));

test("cleanup journal recovery preserves partially consumed authority without replaying a full allowance", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    fake.state.foreignAttachment = true;
    const payload = { ...scoped(lease, "cleanup"), maxCommands: 20 };
    const digest = pin(payload);
    const before = fake.state.calls.length;
    await cleanup(lease, payload);
    const failures = lease.lease.failures;
    const checkpoint = await lease.closeSupervisor();
    const recovered = await WindowsDockerLease.recoverCleanup(
      options(directory, fake.transport),
      checkpoint,
    );
    assert.deepEqual(recovered.lease.failures, failures);
    await cleanup(recovered, payload);
    assert.equal(fake.state.calls.length - before, 20);
    assert.equal(reserved(await journalRows(directory), digest).length, 20);
    assert.equal(
      recovered.lease.failures.at(-1)?.code,
      "CLEANUP_GRANT_EXHAUSTED",
    );
  }));

test("a fresh Node process recovers exhausted authority from disk and cannot erase failures", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    const payload = { ...scoped(lease, "cleanup"), maxCommands: 1 };
    await cleanup(lease, payload);
    const originalFailure = lease.lease.failures[0];
    const checkpoint = await lease.closeSupervisor();
    const fixture = join(directory, "restart.json");
    const cliRoot = realpathSync.native(directory);
    const cliApproval = {
      ...windowsDockerCliBinding(options(directory, fake.transport).dockerCli),
      approvalPath: join(cliRoot, "cli-approval.json"),
      candidateRoot: join(cliRoot, "source"),
      deploymentRoot: join(cliRoot, "deployment"),
    };
    await writeFile(
      fixture,
      JSON.stringify({
        options: options(directory, fake.transport),
        checkpoint,
        payload,
        digest: pin(payload),
        now,
        cliApproval,
      }),
    );
    const moduleUrl = new URL("./windows-resources.mts", import.meta.url).href;
    const cliModuleUrl = new URL("./windows-docker-cli.mts", import.meta.url)
      .href;
    const script = `
    import {readFile} from "node:fs/promises";
    import {WindowsDockerLease} from ${JSON.stringify(moduleUrl)};
    import {loadWindowsDockerCliApproval} from ${JSON.stringify(cliModuleUrl)};
    const input=JSON.parse(await readFile(process.argv[1],"utf8"));
    const cli=input.cliApproval;
    // A restarted process must re-establish independently pinned CLI custody, not deserialize a capability.
    const dockerCli=loadWindowsDockerCliApproval(cli.approvalPath,cli.approvalSha256,
      cli.launchApprovalSha256,cli.candidateRoot,cli.deploymentRoot);
    let calls=0;
    const recovered=await WindowsDockerLease.recoverCleanup({...input.options, dockerCli, environment:{},
      now:()=>input.now, transport:async()=>{calls++;throw new Error("FAKE_TRANSPORT_ONLY");}},input.checkpoint);
    const result=await recovered.cleanup({contract:"G3-D",digestInput:input.payload},{g3dSha256:input.digest});
    const next=await recovered.closeSupervisor();
    console.log(JSON.stringify({calls,result,checkpoint:next}));
  `;
    const child = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", script, fixture],
      {
        timeout: 10000,
        maxBuffer: 65536,
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
        },
      },
    );
    const output: unknown = JSON.parse(child.stdout);
    assert.ok(
      output &&
        typeof output === "object" &&
        "calls" in output &&
        "checkpoint" in output,
    );
    assert.equal(output.calls, 0);
    const nextCheckpoint = output.checkpoint;
    assert.ok(
      nextCheckpoint &&
        typeof nextCheckpoint === "object" &&
        "owner" in nextCheckpoint &&
        "runId" in nextCheckpoint &&
        "token" in nextCheckpoint &&
        "journalSha256" in nextCheckpoint,
    );
    assert.ok(
      typeof nextCheckpoint.owner === "string" &&
        typeof nextCheckpoint.runId === "string" &&
        typeof nextCheckpoint.token === "string" &&
        typeof nextCheckpoint.journalSha256 === "string",
    );
    const recovered = await WindowsDockerLease.recoverCleanup(
      options(directory, fake.transport),
      {
        owner: nextCheckpoint.owner,
        runId: nextCheckpoint.runId,
        token: nextCheckpoint.token,
        journalSha256: nextCheckpoint.journalSha256,
      },
    );
    assert.deepEqual(recovered.lease.failures[0], originalFailure);
    const result = await cleanup(recovered);
    assert.equal(result.status, "CLEAN");
    assert.equal(result.verdict, "FAIL");
    assert.deepEqual(result.failures[0], originalFailure);
  }));

test("uncertain read-command responses consume reservations without refunds across retries", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    let armed = false;
    let lost = false;
    const transport: DockerCommandTransport = async (...args) => {
      const result = await fake.transport(...args);
      const command = args[1].slice(2);
      if (
        armed &&
        !lost &&
        command[0] === "volume" &&
        command[1] === "inspect"
      ) {
        lost = true;
        return { ...ok(), code: null, timedOut: true };
      }
      return result;
    };
    const lease = await WindowsDockerLease.acquire(
      options(directory, transport),
    );
    const payload = scoped(lease, "cleanup");
    const digest = pin(payload);
    armed = true;
    assert.equal((await cleanup(lease, payload)).status, "INCOMPLETE");
    const consumed = reserved(await journalRows(directory), digest).length;
    assert.equal(consumed, 2);
    const result = await cleanup(lease, payload);
    const reservations = reserved(await journalRows(directory), digest);
    assert.equal(reservations[consumed]?.ordinal, consumed + 1);
    assert.equal(result.status, "CLEAN");
    assert.equal(result.failures[0]?.category, "PROCESS");
    assert.equal(result.verdict, "FAIL");
  }));

test("destructive commands have synced reservations before dispatch and uncertainty never refunds them", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    let witnessed = false;
    const transport: DockerCommandTransport = async (...args) => {
      if (args[1][2] === "stop") {
        const rows = await journalRows(directory);
        const last = rows.at(-1);
        assert.equal(last?.event, "COMMAND_RESERVED");
        assert.ok(last);
        assert.equal(last.command, "stop");
        assert.equal(last.destructive, true);
        witnessed = true;
        return { ...ok(), code: null, timedOut: true };
      }
      return fake.transport(...args);
    };
    const lease = await WindowsDockerLease.acquire(
      options(directory, transport),
    );
    const payload = scoped(lease, "cleanup");
    const digest = pin(payload);
    assert.equal((await cleanup(lease, payload)).status, "INCOMPLETE");
    assert.equal(witnessed, true);
    const before = fake.state.calls.length;
    const count = reserved(await journalRows(directory), digest).length;
    assert.equal((await cleanup(lease, payload)).status, "INCOMPLETE");
    assert.equal(fake.state.calls.length, before);
    assert.equal(reserved(await journalRows(directory), digest).length, count);
    assert.equal(
      lease.lease.failures.at(-1)?.code,
      "UNRESOLVED_DESTRUCTIVE_COMMAND",
    );
  }));

test("changed digests, wrong run or lease and mismatched resource authority cannot borrow a grant budget", async () => {
  for (const scenario of [
    "changedDigest",
    "wrongRun",
    "wrongLease",
    "wrongResource",
  ] as const)
    await sandbox(async (directory) => {
      const fake = fakeDocker();
      const lease = await WindowsDockerLease.acquire(
        options(directory, fake.transport),
      );
      const payload = scoped(lease, "cleanup");
      const approved = pin(payload);
      const before = fake.state.calls.length;
      if (scenario === "changedDigest") payload.maxCommands = 501;
      if (scenario === "wrongRun")
        payload.runId = "33333333-3333-4333-8333-333333333333";
      if (scenario === "wrongLease")
        payload.owner = "44444444-4444-4444-8444-444444444444";
      if (scenario === "wrongResource")
        payload.resources.containerId = foreignId;
      const result = await lease.cleanup(grant("G3-D", payload), {
        g3dSha256: scenario === "changedDigest" ? approved : pin(payload),
      });
      assert.equal(result.status, "INCOMPLETE");
      assert.equal(result.failures[0]?.category, "AUTHORIZATION");
      assert.equal(fake.state.calls.length, before);
      assert.equal(
        (await journalRows(directory)).filter(
          (row) => row.event === "GRANT_BOUND",
        ).length,
        0,
      );
    });
});

test("fresh reviewed authority supersedes older partial grants without erasing their consumption or failures", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    fake.state.foreignAttachment = true;
    const old = scoped(lease, "cleanup");
    const fresh = { ...old, maxCommands: 501 };
    await cleanup(lease, old);
    await cleanup(lease, fresh);
    const before = fake.state.calls.length;
    await cleanup(lease, old);
    assert.equal(fake.state.calls.length, before);
    assert.equal(lease.lease.failures.at(-1)?.code, "CLEANUP_GRANT_SUPERSEDED");
    const rows = await journalRows(directory);
    assert.ok(
      reserved(rows, pin(old)).length > 0 &&
        reserved(rows, pin(fresh)).length > 0,
    );
    const failures = lease.lease.failures;
    fake.state.foreignAttachment = false;
    const result = await cleanup(lease, fresh);
    assert.equal(result.status, "CLEAN");
    assert.deepEqual(result.failures, failures);
    assert.equal(result.verdict, "FAIL");
  }));

test("cleanup safety failures survive later successful deletion with original category evidence and time", async () => {
  for (const scenario of [
    "foreignAttachment",
    "foreignNetworkMember",
    "replaceVolume",
    "renameContainer",
    "ownerMismatch",
    "drift",
  ] as const)
    await sandbox(async (directory) => {
      const fake = fakeDocker();
      const lease = await WindowsDockerLease.acquire(
        options(directory, fake.transport),
      );
      if (scenario === "ownerMismatch")
        fake.state.labels.get("container")!["stockwise.d5.owner"] = "foreign";
      else fake.state[scenario] = true;
      const payload = scoped(lease, "cleanup");
      const first = await cleanup(lease, payload);
      assert.equal(first.status, "INCOMPLETE");
      assert.equal(first.verdict, "FAIL");
      assert.equal(first.failures[0]?.category, "SAFETY");
      assert.equal(first.failures[0]?.timestamp, now);
      assert.equal(first.failures[0]?.evidence.phase, "verify-lease");
      if (scenario === "ownerMismatch")
        fake.state.labels.get("container")!["stockwise.d5.owner"] = owner;
      else fake.state[scenario] = false;
      const result = await cleanup(lease, payload);
      assert.equal(result.status, "CLEAN");
      assert.equal(result.verdict, "FAIL");
      assert.deepEqual(result.failures, first.failures);
      assert.throws(
        () => assertWindowsLeasePass(result),
        /WINDOWS_LEASE_NOT_PASS/,
      );
      const rows = await journalRows(directory);
      assert.equal(
        rows.filter((row) => row.event === "PROCESS_FAILURE").length,
        0,
      );
      assert.ok(
        rows.some(
          (row) => row.event === "PROCESS_RESULT" && row.exitCode === 0,
        ),
      );
    });
});

test("authorization violations remain failed after newly approved successful cleanup", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    const payload = scoped(lease, "cleanup");
    await lease.cleanup(grant("G3-D", payload), { g3dSha256: source });
    const failure = lease.lease.failures[0];
    assert.equal(failure?.category, "AUTHORIZATION");
    const result = await cleanup(lease, { ...payload, maxCommands: 501 });
    assert.equal(result.status, "CLEAN");
    assert.equal(result.verdict, "FAIL");
    assert.deepEqual(result.failures[0], failure);
  }));

test("journal reload retains safety failures independently of a later clean resource disposition", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    fake.state.foreignAttachment = true;
    const payload = scoped(lease, "cleanup");
    await cleanup(lease, payload);
    const failures = lease.lease.failures;
    const checkpoint = await lease.closeSupervisor();
    const recovered = await WindowsDockerLease.recoverCleanup(
      options(directory, fake.transport),
      checkpoint,
    );
    assert.deepEqual(recovered.lease.failures, failures);
    fake.state.foreignAttachment = false;
    const result = await cleanup(recovered, payload);
    assert.equal(result.status, "CLEAN");
    assert.deepEqual(result.failures, failures);
    assert.equal(result.verdict, "FAIL");
  }));

test("ordinary waiting for G3-D is not a safety violation and clean recovered authority can still PASS", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    const checkpoint = await lease.closeSupervisor();
    const recovered = await WindowsDockerLease.recoverCleanup(
      options(directory, fake.transport),
      checkpoint,
    );
    const before = fake.state.calls.length;
    const waiting = await recovered.cleanup(null, { g3dSha256: source });
    assert.equal(waiting.status, "INCOMPLETE");
    assert.equal(waiting.verdict, "INCOMPLETE");
    assert.equal(waiting.failureCount, 0);
    assert.equal(fake.state.calls.length, before);
    const result = await cleanup(recovered);
    assert.equal(result.status, "CLEAN");
    assert.equal(result.verdict, "PASS");
    assertWindowsLeasePass(result);
  }));

test("stale checkpoints, interrupted journal tails and stale supervisor locks reject recovery without Docker", async () => {
  await sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    const old = await lease.closeSupervisor();
    const recovered = await WindowsDockerLease.recoverCleanup(
      options(directory, fake.transport),
      old,
    );
    await recovered.closeSupervisor();
    const before = fake.state.calls.length;
    await assert.rejects(
      WindowsDockerLease.recoverCleanup(
        options(directory, fake.transport),
        old,
      ),
      /STALE_OR_UNRECONCILED/,
    );
    assert.equal(fake.state.calls.length, before);
  });
  await sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    const checkpoint = await lease.closeSupervisor();
    const file = join(directory, owner, "journal.jsonl");
    await writeFile(file, (await readFile(file)).subarray(0, -1));
    await assert.rejects(
      WindowsDockerLease.recoverCleanup(
        options(directory, fake.transport),
        checkpoint,
      ),
      /INTERRUPTED_APPEND/,
    );
  });
  await sandbox(async (directory) => {
    const fake = fakeDocker();
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport),
    );
    const checkpoint = await lease.closeSupervisor();
    const file = join(directory, owner, "supervisor.lock");
    await writeFile(file, "stale-supervisor");
    await assert.rejects(
      WindowsDockerLease.recoverCleanup(
        options(directory, fake.transport),
        checkpoint,
      ),
      /EEXIST/,
    );
    assert.equal(await readFile(file, "utf8"), "stale-supervisor");
  });
});

test("interruption without a command result retains the reserved allowance after journal recovery", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    let armed = false;
    let interrupted = false;
    const transport: DockerCommandTransport = async (...args) => {
      const reply = await fake.transport(...args);
      const command = args[1].slice(2);
      if (
        armed &&
        !interrupted &&
        command[0] === "volume" &&
        command[1] === "inspect"
      ) {
        interrupted = true;
        throw new Error("SYNTHETIC_CLIENT_INTERRUPTION");
      }
      return reply;
    };
    const lease = await WindowsDockerLease.acquire(
      options(directory, transport),
    );
    const payload = { ...scoped(lease, "cleanup"), maxCommands: 20 };
    const digest = pin(payload);
    const before = fake.state.calls.length;
    armed = true;
    await cleanup(lease, payload);
    const rows = await journalRows(directory);
    const prior = lease.lease.failures[0];
    const reservations = reserved(rows, digest);
    assert.equal(reservations.length, 2);
    assert.equal(
      rows.some(
        (row) =>
          row.event === "COMMAND_RESULT" &&
          row.reservation === reservations[1]!.seq,
      ),
      false,
    );
    const checkpoint = await lease.closeSupervisor();
    const recovered = await WindowsDockerLease.recoverCleanup(
      options(directory, fake.transport),
      checkpoint,
    );
    assert.deepEqual(recovered.lease.failures[0], prior);
    await cleanup(recovered, payload);
    assert.equal(reserved(await journalRows(directory), digest).length, 20);
    assert.equal(fake.state.calls.length - before, 20);
    assert.equal(recovered.lease.verdict, "FAIL");
  }));

test("authority expiring during durable reservation is refused before dispatch without refund or invented process exit", async () =>
  sandbox(async (directory) => {
    const fake = fakeDocker();
    let clock = now;
    let armed = false;
    const currentTime = () => {
      if (armed) {
        const rows = readFileSync(
          join(directory, owner, "journal.jsonl"),
          "utf8",
        )
          .trimEnd()
          .split("\n");
        const last = JSON.parse(rows.at(-1)!) as ObjectRecord;
        if (last.event === "COMMAND_RESERVED") clock = now + 60001;
      }
      return clock;
    };
    const lease = await WindowsDockerLease.acquire(
      options(directory, fake.transport, { now: currentTime }),
    );
    const payload = scoped(lease, "cleanup");
    const before = fake.state.calls.length;
    armed = true;
    const result = await cleanup(lease, payload);
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(result.verdict, "FAIL");
    assert.equal(result.failures[0]?.category, "AUTHORIZATION");
    assert.equal(fake.state.calls.length, before);
    const rows = await journalRows(directory);
    assert.equal(reserved(rows, pin(payload)).length, 1);
    assert.equal(
      rows.filter((row) => row.event === "COMMAND_NOT_DISPATCHED").length,
      1,
    );
    assert.equal(
      rows.filter((row) => row.event === "COMMAND_RESULT").length,
      0,
    );
  }));
