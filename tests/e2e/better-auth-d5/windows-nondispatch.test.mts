import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  LeaseJournal,
  type JournalCheckpoint,
} from "./windows-lease-journal.mts";
import {
  WindowsDockerLease,
  WINDOWS_DOCKER_ENDPOINT,
  type CleanupRecoveryOptions,
  type DockerCommandResult,
  type DockerCommandTransport,
} from "./windows-resources.mts";
import {
  createDockerDispatchAttempt,
  dispatchDockerCommand,
  refuseDockerDispatch,
} from "./windows-command-dispatch.mts";
import { createDockerCliFixture } from "./windows-docker-cli.fixture.mts";
import { windowsDockerCliBinding } from "./windows-docker-cli.mts";
let currentTime = 1_000_000;
const source = "a".repeat(64);
const owner = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const token = "33333333-3333-4333-8333-333333333333";
const containerId = "c".repeat(64);
const networkId = "d".repeat(64);
const volumeBirth = "2026-10-17T00:00:00Z";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
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
};
const ok = (stdout = ""): DockerCommandResult => ({
  stdout,
  stderr: "",
  code: 0,
  signal: null,
  timedOut: false,
});
const image = `postgres:16.15-alpine@sha256:${"b".repeat(64)}`;
const resolvedImageId = `sha256:${"e".repeat(64)}`;
const stem = `sw-d5-${owner}`;
const resources = [
  {
    kind: "volume",
    name: `${stem}-data`,
    identity: volumeBirth,
    confirmed: true,
    attempted: true,
  },
  {
    kind: "network",
    name: `${stem}-net`,
    identity: networkId,
    confirmed: true,
    attempted: true,
  },
  {
    kind: "container",
    name: `${stem}-pg`,
    identity: containerId,
    confirmed: true,
    attempted: true,
  },
];

async function fixture(
  run: (value: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "stockwise-d5-nondispatch-"));
  currentTime = 1_000_000;
  try {
    await run(await createFixture(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createFixture(directory: string) {
  const dockerCli = createDockerCliFixture(directory).approval;
  const configuration = {
    endpoint: WINDOWS_DOCKER_ENDPOINT,
    daemonId: "synthetic-daemon",
    sourceSha256: source,
    migrationSha256: source,
    image,
    resolvedImageId,
    journalDirectory: directory,
    operatorSha256: hash("synthetic-operator"),
    dockerCli: windowsDockerCliBinding(dockerCli),
  };
  const state = {
    owner,
    runId,
    token,
    journalDirectory: directory,
    containerName: `${stem}-pg`,
    networkName: `${stem}-net`,
    volumeName: `${stem}-data`,
    containerId,
    networkId,
    volumeBirth,
    status: "ACQUIRED",
  };
  const journal = await LeaseJournal.create(
    directory,
    { owner, runId, token },
    () => currentTime,
  );
  await journal.event("LEASE", { ...state, configuration });
  for (const resource of resources) {
    await journal.event("CREATE_INTENT", {
      kind: resource.kind,
      name: resource.name,
    });
    await journal.event("CREATE_RESPONSE", {
      kind: resource.kind,
      name: resource.name,
      identity: resource.kind === "volume" ? null : resource.identity,
    });
    await journal.event("CREATE_CONFIRMED", {
      kind: resource.kind,
      name: resource.name,
      identity: resource.identity,
    });
  }
  let checkpoint = await journal.close({
    state,
    configuration,
    resources,
    failureCount: 0,
  });
  const options: CleanupRecoveryOptions = {
    leaseId: owner,
    journalDirectory: directory,
    environment: {},
    sourceSha256: source,
    migrationSha256: source,
    expectedSourceSha256: source,
    expectedMigrationSha256: source,
    operator: "synthetic-operator",
    endpoint: WINDOWS_DOCKER_ENDPOINT,
    daemonId: "synthetic-daemon",
    image,
    resolvedImageId,
    dockerCli,
    now: () => currentTime,
    transport: async () => {
      throw new Error("unexpected default transport");
    },
  };
  let authorization = 0;
  const payload = () => ({
    operation: "cleanup",
    owner,
    runId,
    operator: options.operator,
    endpoint: options.endpoint,
    daemonId: options.daemonId,
    image,
    resolvedImageId,
    sourceSha256: source,
    migrationSha256: source,
    journalDirectory: directory,
    commandTimeoutMs: 30_000,
    maxCommands: Math.max(1, 100 - authorization),
    expiresAt: currentTime + 60_000 + authorization++,
    resources: {
      token,
      containerId,
      containerName: state.containerName,
      networkId,
      networkName: state.networkName,
      volumeName: state.volumeName,
      volumeBirth,
    },
    actions: [
      "stop-5s-then-force",
      "remove-container",
      "remove-network",
      "remove-volume",
    ],
    exclusiveWindow: "operator-prevents-concurrent-lease-mutation",
    volumeRace: "accept-non-atomic-volume-name-deletion",
  });
  const transportState = {
    calls: [] as string[][],
    removed: new Set<string>(),
    stopError: null as "generic" | "branded" | null,
    forgeOutcome: false,
  };
  const transport: DockerCommandTransport = async (_exe, argv) => {
    const args = argv.slice(2);
    transportState.calls.push([...args]);
    if (args[0] === "info") return ok("synthetic-daemon");
    if (args[0] === "ps")
      return transportState.removed.has("container") ? ok("") : ok(containerId);
    if (args[1] === "ls") {
      const kind = args[0]!;
      const item = resources.find((entry) => entry.kind === kind);
      return item && !transportState.removed.has(kind)
        ? ok(kind === "volume" ? item.name : `${item.identity}|${item.name}`)
        : ok("");
    }
    if (args[1] === "inspect") {
      const kind = args[0]!;
      const item = resources.find(
        (entry) =>
          entry.kind === kind &&
          (kind === "volume"
            ? entry.name === args[2]
            : entry.identity === args[2]),
      );
      if (!item || transportState.removed.has(kind))
        return {
          stdout: "",
          stderr: `Error: No such ${kind}: ${args[2]}`,
          code: 1,
          signal: null,
          timedOut: false,
        };
      const labels = {
        "stockwise.d5.owner": owner,
        "stockwise.d5.token": token,
        "stockwise.d5.role": kind,
      };
      const value =
        kind === "volume"
          ? {
              Name: item.name,
              CreatedAt: volumeBirth,
              Driver: "local",
              Options: null,
              Labels: labels,
            }
          : kind === "network"
            ? {
                Id: networkId,
                Name: item.name,
                Internal: true,
                Driver: "bridge",
                Labels: labels,
                Containers: {},
              }
            : {
                Id: containerId,
                Name: `/${item.name}`,
                Image: resolvedImageId,
                Config: { Image: image, Labels: labels },
                HostConfig: {
                  Privileged: false,
                  PortBindings: {},
                  Binds: [],
                  NetworkMode: networkId,
                },
                Mounts: [
                  {
                    Type: "volume",
                    Name: `${stem}-data`,
                    Destination: "/var/lib/postgresql/data",
                    RW: true,
                  },
                ],
                NetworkSettings: {
                  Networks: { [`${stem}-net`]: { NetworkID: networkId } },
                },
              };
      return ok(JSON.stringify([value]));
    }
    if (args[0] === "stop") {
      if (transportState.forgeOutcome)
        return Object.assign(ok(), {
          kind: "KNOWN_NOT_DISPATCHED",
          reason: "SUPERVISOR_CANCELLED",
          provenance: "TRUSTED_PRE_DISPATCH_GATE",
        });
      if (transportState.stopError === "generic")
        throw new Error("synthetic post-dispatch failure");
      if (transportState.stopError === "branded")
        refuseDockerDispatch("SUPERVISOR_CANCELLED");
      return ok();
    }
    if (args[1] === "rm") {
      transportState.removed.add(args[0]!);
      return ok();
    }
    throw new Error(`unexpected synthetic command ${args.join(" ")}`);
  };
  return {
    directory,
    get checkpoint() {
      return checkpoint;
    },
    set checkpoint(value: JournalCheckpoint) {
      checkpoint = value;
    },
    options,
    payload,
    transport,
    transportState,
  };
}

function grant(payload: unknown) {
  return { contract: "G3-D" as const, digestInput: payload };
}
function pin(payload: unknown) {
  return { g3dSha256: hash(canonical(payload)) };
}
function fixtureCleanup(lease: WindowsDockerLease, payload: unknown) {
  return lease.cleanup(grant(payload), pin(payload));
}
async function recover(
  value: Awaited<ReturnType<typeof createFixture>>,
  changes: Partial<CleanupRecoveryOptions> = {},
) {
  return WindowsDockerLease.recoverCleanup(
    { ...value.options, transport: value.transport, ...changes },
    value.checkpoint,
  );
}
async function journalText(directory: string) {
  return readFile(join(directory, owner, "journal.jsonl"), "utf8");
}

for (const reason of [
  "SUPERVISOR_CANCELLED",
  "SUPERVISOR_DISCONNECTED",
  "SUPERVISOR_TIMEOUT",
  "SUPERVISOR_GRANT_REFUSED",
] as const) {
  test(`cleanup pre-dispatch ${reason} retains consumed reservation and later releases safely`, async () =>
    fixture(async (value) => {
      let stopGate = false;
      const lease = await recover(value, {
        beforeDispatch: {
          check: async (_exe, args) => {
            stopGate = args[2] === "stop";
            if (stopGate && reason !== "SUPERVISOR_TIMEOUT")
              refuseDockerDispatch(reason);
          },
          assertTime: () => {
            if (stopGate) refuseDockerDispatch(reason);
          },
        },
      });
      const payload = value.payload();
      const first = await lease.cleanup(grant(payload), pin(payload));
      assert.equal(first.status, "INCOMPLETE");
      assert.equal(
        value.transportState.calls.some((args) => args[0] === "stop"),
        false,
      );
      const text = await journalText(value.directory);
      assert.match(text, new RegExp(`"reason":"${reason}"`));
      assert.match(text, /"provenance":"TRUSTED_PRE_DISPATCH_GATE"/);
      assert.match(text, /"uncertain":false/);
      const rows = text
        .trim()
        .split("\n")
        .map(
          (row) =>
            JSON.parse(row) as {
              event?: string;
              reservation?: number;
              command?: string;
              seq?: number;
            },
        );
      const reservation = rows.find(
        (row) => row.event === "COMMAND_RESERVED" && row.command === "stop",
      );
      const refused = rows.find(
        (row) => row.event === "COMMAND_NOT_DISPATCHED",
      );
      assert.ok(reservation);
      assert.equal(refused?.reservation, reservation?.seq);
      const released = await lease.closeSupervisor();
      value.checkpoint = released;
      const reloaded = await recover(value);
      assert.equal(reloaded.lease.failureCount, 1);
      assert.equal(reloaded.lease.verdict, "FAIL");
      const secondPayload = value.payload();
      const clean = await reloaded.cleanup(
        grant(secondPayload),
        pin(secondPayload),
      );
      assert.equal(clean.status, "CLEAN");
      assert.equal(clean.failureCount, 1);
      assert.equal(clean.verdict, "FAIL");
    }));
}

test("simulated gate interruption after reservation leaves no proof and blocks dispatch", async () =>
  fixture(async (value) => {
    const forged = await recover(value, {
      beforeDispatch: {
        check: async (_exe, args) => {
          if (args[2] === "stop") throw new Error("SUPERVISOR_CANCELLED");
        },
        assertTime: () => {},
      },
    });
    await fixtureCleanup(forged, value.payload());
    assert.equal(
      value.transportState.calls.some((args) => args[0] === "stop"),
      false,
    );
    assert.match(await journalText(value.directory), /COMMAND_RESERVED/);
    const rows = (await journalText(value.directory))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            event: string;
            command?: string;
            seq?: number;
            reservation?: number;
          },
      );
    const pendingStop = rows.find(
      (row) => row.event === "COMMAND_RESERVED" && row.command === "stop",
    );
    assert.ok(pendingStop);
    assert.equal(
      rows.some(
        (row) =>
          row.reservation === pendingStop.seq &&
          (row.event === "COMMAND_NOT_DISPATCHED" ||
            row.event === "COMMAND_RESULT"),
      ),
      false,
    );
    value.checkpoint = await forged.closeSupervisor();
    const reloaded = await recover(value);
    const callsBefore = value.transportState.calls.length;
    const result = await fixtureCleanup(reloaded, value.payload());
    assert.equal(result.status, "INCOMPLETE");
    assert.ok(
      result.failures.some(
        (failure) => failure.code === "UNRESOLVED_DESTRUCTIVE_COMMAND",
      ),
    );
    assert.equal(value.transportState.calls.length, callsBefore);
    await reloaded.closeSupervisor();
  }));

test("a first authorized cleanup without a dispatch refusal passes", async () =>
  fixture(async (value) => {
    const lease = await recover(value);
    const payload = value.payload();
    const result = await lease.cleanup(grant(payload), pin(payload));
    assert.equal(result.status, "CLEAN");
    assert.equal(result.verdict, "PASS");
  }));

test("grant expiry after reservation is a trusted pre-dispatch refusal", async () =>
  fixture(async (value) => {
    const lease = await recover(value, {
      beforeDispatch: {
        check: async (_exe, args) => {
          if (args[2] === "stop") currentTime += 60_001;
        },
        assertTime: () => {},
      },
    });
    const payload = value.payload();
    const result = await lease.cleanup(grant(payload), pin(payload));
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(
      value.transportState.calls.some((args) => args[0] === "stop"),
      false,
    );
    assert.match(
      await journalText(value.directory),
      /AUTHORITY_EXPIRED_BEFORE_DISPATCH/,
    );
    assert.match(
      await journalText(value.directory),
      /"category":"AUTHORIZATION"/,
    );
    await lease.closeSupervisor();
  }));

for (const failure of ["generic", "branded"] as const) {
  test(`a ${failure} transport throw after stop dispatch remains unresolved`, async () =>
    fixture(async (value) => {
      value.transportState.stopError = failure;
      const lease = await recover(value);
      const payload = value.payload();
      const result = await lease.cleanup(grant(payload), pin(payload));
      assert.equal(result.status, "INCOMPLETE");
      assert.ok(
        result.failures.some(
          (entry) => entry.code === "DOCKER_TRANSPORT_UNCERTAIN",
        ),
      );
      assert.equal(
        value.transportState.calls.filter((args) => args[0] === "stop").length,
        1,
      );
      const journal = await journalText(value.directory);
      assert.match(journal, /COMMAND_RESERVED/);
      assert.doesNotMatch(journal, /COMMAND_NOT_DISPATCHED/);
      value.checkpoint = await lease.closeSupervisor();
      const reloaded = await recover(value);
      const beforeRetry = value.transportState.calls.length;
      const retry = await fixtureCleanup(reloaded, value.payload());
      assert.equal(retry.status, "INCOMPLETE");
      assert.ok(
        retry.failures.some(
          (entry) => entry.code === "UNRESOLVED_DESTRUCTIVE_COMMAND",
        ),
      );
      assert.equal(value.transportState.calls.length, beforeRetry);
      await reloaded.closeSupervisor();
    }));
}

test("a failed COMMAND_NOT_DISPATCHED journal append leaves the reservation unresolved", async () =>
  fixture(async (value) => {
    const original = LeaseJournal.prototype.notDispatched;
    LeaseJournal.prototype.notDispatched = async function () {
      throw new Error("synthetic proof append interruption");
    };
    try {
      const lease = await recover(value, {
        beforeDispatch: {
          check: async (_exe, args) => {
            if (args[2] === "stop")
              refuseDockerDispatch("SUPERVISOR_CANCELLED");
          },
          assertTime: () => {},
        },
      });
      await fixtureCleanup(lease, value.payload());
      assert.equal(
        value.transportState.calls.some((args) => args[0] === "stop"),
        false,
      );
      assert.match(await journalText(value.directory), /COMMAND_RESERVED/);
      assert.doesNotMatch(
        await journalText(value.directory),
        /COMMAND_NOT_DISPATCHED/,
      );
      value.checkpoint = await lease.closeSupervisor();
    } finally {
      LeaseJournal.prototype.notDispatched = original;
    }
    const reloaded = await recover(value);
    const callsBefore = value.transportState.calls.length;
    const refused = await fixtureCleanup(reloaded, value.payload());
    assert.equal(refused.status, "INCOMPLETE");
    assert.ok(
      refused.failures.some(
        (failure) => failure.code === "UNRESOLVED_DESTRUCTIVE_COMMAND",
      ),
    );
    assert.equal(value.transportState.calls.length, callsBefore);
    await reloaded.closeSupervisor();
  }));

test("durable refusal evidence survives release and reload without refunding the reservation", async () =>
  fixture(async (value) => {
    const lease = await recover(value, {
      beforeDispatch: {
        check: async (_exe, args) => {
          if (args[2] === "stop") refuseDockerDispatch("SUPERVISOR_CANCELLED");
        },
        assertTime: () => {},
      },
    });
    const firstPayload = value.payload();
    await lease.cleanup(grant(firstPayload), pin(firstPayload));
    const checkpoint = await lease.closeSupervisor();
    value.checkpoint = checkpoint;
    assert.match(await journalText(value.directory), /COMMAND_NOT_DISPATCHED/);
    const reloaded = await recover(value);
    assert.equal(reloaded.lease.failureCount, 1);
    assert.equal(
      reloaded.lease.failures[0]?.code,
      "DOCKER_COMMAND_NOT_DISPATCHED",
    );
    const renewed = value.payload();
    await reloaded.cleanup(grant(renewed), pin(renewed));
    assert.equal(
      value.transportState.calls.filter((args) => args[0] === "stop").length,
      1,
    );
    assert.equal(reloaded.lease.status, "CLEAN");
    assert.equal(reloaded.lease.verdict, "FAIL");
  }));
test("known refusal reservations remain consumed across recovery and cumulative retries", async () =>
  fixture(async (value) => {
    const gate = {
      check: async (_exe: string, args: readonly string[]) => {
        if (args[2] === "stop") refuseDockerDispatch("SUPERVISOR_CANCELLED");
      },
      assertTime: () => {},
    };
    const lease = await recover(value, { beforeDispatch: gate });
    const payload = value.payload();
    await fixtureCleanup(lease, payload);
    value.checkpoint = await lease.closeSupervisor();
    const recovered = await recover(value, { beforeDispatch: gate });
    await fixtureCleanup(recovered, payload);
    const rows = (await journalText(value.directory))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            event: string;
            grantDigest?: string;
            ordinal?: number;
          },
      );
    assert.equal(rows.filter((row) => row.event === "GRANT_BOUND").length, 1);
    assert.equal(
      rows.filter((row) => row.event === "COMMAND_NOT_DISPATCHED").length,
      2,
    );
    const used = rows.filter((row) => row.event === "COMMAND_RESERVED");
    assert.deepEqual(
      used.map((row) => row.ordinal),
      used.map((_row, index) => index + 1),
    );
    assert.equal(
      value.transportState.calls.some((args) => args[0] === "stop"),
      false,
    );
    await recovered.closeSupervisor();
  }));
test("a forged raw transport outcome is rejected rather than treated as gate proof", async () =>
  fixture(async (value) => {
    value.transportState.forgeOutcome = true;
    const lease = await recover(value);
    const result = await fixtureCleanup(lease, value.payload());
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(
      value.transportState.calls.filter((args) => args[0] === "stop").length,
      1,
    );
    const journal = await journalText(value.directory);
    assert.match(journal, /COMMAND_RESERVED/);
    assert.doesNotMatch(journal, /COMMAND_NOT_DISPATCHED/);
    await lease.closeSupervisor();
  }));

test("a consumed cleanup grant budget is not replenished by retry", async () =>
  fixture(async (value) => {
    const lease = await recover(value, {
      beforeDispatch: {
        check: async (_exe, args) => {
          if (args[2] === "stop") refuseDockerDispatch("SUPERVISOR_TIMEOUT");
        },
        assertTime: () => {},
      },
    });
    const payload = { ...value.payload(), maxCommands: 32 };
    for (let attempt = 0; attempt <= payload.maxCommands; attempt++)
      await fixtureCleanup(lease, payload);
    const rows = (await journalText(value.directory))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string; ordinal?: number });
    const consumed = rows.filter((row) => row.event === "COMMAND_RESERVED");
    assert.equal(consumed.length, payload.maxCommands);
    assert.equal(consumed.at(-1)?.ordinal, payload.maxCommands);
    assert.equal(rows.filter((row) => row.event === "GRANT_BOUND").length, 1);
    const callsBeforeRetry = value.transportState.calls.length;
    const retry = await fixtureCleanup(lease, payload);
    assert.equal(retry.status, "INCOMPLETE");
    assert.equal(value.transportState.calls.length, callsBeforeRetry);
    assert.equal(
      value.transportState.calls.some((args) => args[0] === "stop"),
      false,
    );
    await lease.closeSupervisor();
  }));

test("journal refuses forged and reused proof capabilities while preserving reservations", async () =>
  fixture(async (value) => {
    const root = join(value.directory, "proof-only");
    const journal = await LeaseJournal.create(
      root,
      { owner, runId, token },
      () => currentTime,
    );
    const digest = "f".repeat(64);
    await journal.bindGrant(digest, 3, currentTime + 60_000);
    const first = await journal.reserve(digest, "stop", true);
    const reservationRow = (
      await readFile(join(root, owner, "journal.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            event: string;
            seq: number;
            attemptId?: string;
          },
      )
      .find((row) => row.event === "COMMAND_RESERVED" && row.seq === first);
    assert.ok(reservationRow);
    assert.ok(reservationRow.attemptId);
    const beforeUnauthorizedWrite = await readFile(
      join(root, owner, "journal.jsonl"),
      "utf8",
    );
    await assert.rejects(
      journal.event("COMMAND_NOT_DISPATCHED", {
        reservation: first,
        uncertain: false,
        attemptId: reservationRow.attemptId,
        reason: "SUPERVISOR_CANCELLED",
        provenance: "TRUSTED_PRE_DISPATCH_GATE",
      }),
      /LEASE_RESULT_HISTORY_INVALID/,
    );
    assert.equal(
      await readFile(join(root, owner, "journal.jsonl"), "utf8"),
      beforeUnauthorizedWrite,
    );
    await assert.rejects(
      journal.notDispatched(first, {
        kind: "KNOWN_NOT_DISPATCHED",
        attemptId: reservationRow.attemptId,
        reason: "SUPERVISOR_CANCELLED",
        provenance: "TRUSTED_PRE_DISPATCH_GATE",
      }),
      /LEASE_RESULT_HISTORY_INVALID/,
    );
    const refusal = {
      check: async () => refuseDockerDispatch("SUPERVISOR_CANCELLED"),
      assertTime: () => {},
    };
    const outcome = await journal.dispatchCommand(
      first,
      async () => {
        throw new Error("DELEGATE_MUST_NOT_RUN");
      },
      "docker",
      ["stop", containerId],
      { timeoutMs: 30_000, maxOutputBytes: 1024, environment: {} },
      refusal,
      () => {},
    );
    assert.equal(outcome.kind, "KNOWN_NOT_DISPATCHED");
    if (outcome.kind !== "KNOWN_NOT_DISPATCHED")
      throw new Error("missing trusted proof");
    await journal.notDispatched(first, outcome);
    await assert.rejects(
      journal.notDispatched(first, outcome),
      /LEASE_RESERVATION_UNAVAILABLE/,
    );
    const second = await journal.reserve(digest, "stop", true);
    const secondOutcome = await journal.dispatchCommand(
      second,
      async () => {
        throw new Error("DELEGATE_MUST_NOT_RUN");
      },
      "docker",
      ["stop", containerId],
      { timeoutMs: 30_000, maxOutputBytes: 1024, environment: {} },
      refusal,
      () => {},
    );
    assert.equal(secondOutcome.kind, "KNOWN_NOT_DISPATCHED");
    if (secondOutcome.kind !== "KNOWN_NOT_DISPATCHED")
      throw new Error("missing pending refusal proof");
    const checkpoint = await journal.close({});
    const recovered = await LeaseJournal.recover(
      root,
      checkpoint,
      () => currentTime,
    );
    await assert.rejects(
      recovered.notDispatched(first, outcome),
      /LEASE_RESERVATION_UNAVAILABLE/,
    );
    await assert.rejects(
      recovered.notDispatched(second, secondOutcome),
      /LEASE_RESERVATION_UNAVAILABLE/,
    );

    assert.equal(recovered.unresolvedDestructive, true);
    await recovered.close({});
  }));

test("a first-use refusal from another reservation cannot clear an uncertain stop", async () =>
  fixture(async (value) => {
    const original = LeaseJournal.prototype.dispatchCommand;
    const capturedJournals: LeaseJournal[] = [];
    let reservationA: number | undefined;
    LeaseJournal.prototype.dispatchCommand = async function (
      reservation,
      ...args
    ) {
      if ((args[2] as readonly string[] | undefined)?.[2] === "stop") {
        capturedJournals.push(this);
        reservationA = reservation;
      }
      return original.call(this, reservation, ...args);
    };
    let lease: WindowsDockerLease | undefined;
    try {
      value.transportState.stopError = "generic";
      lease = await recover(value);
      const result = await fixtureCleanup(lease, value.payload());
      assert.equal(
        value.transportState.calls.filter((args) => args[0] === "stop").length,
        1,
      );
      assert.equal(result.status, "INCOMPLETE");
      assert.ok(reservationA);
    } finally {
      LeaseJournal.prototype.dispatchCommand = original;
    }
    const journal = capturedJournals[0];
    assert.ok(journal);
    const rowsBeforeB = (await journalText(value.directory))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            event: string;
            seq: number;
            reservation?: number;
            grantDigest?: string;
            command?: string;
            attemptId?: string;
            ordinal?: number;
          },
      );
    const rowA = rowsBeforeB.find(
      (row) =>
        row.event === "COMMAND_RESERVED" &&
        row.seq === reservationA &&
        row.command === "stop",
    );
    assert.ok(rowA);
    assert.ok(rowA.grantDigest);
    assert.ok(rowA.attemptId);
    const candidateAttempt = createDockerDispatchAttempt({
      journal: journal!,
      owner,
      runId,
      token,
      reservation: reservationA!,
      grantDigest: rowA.grantDigest,
      attemptId: rowA.attemptId,
    });
    const candidateProof = await dispatchDockerCommand(
      candidateAttempt,
      async () => {
        throw new Error("CANDIDATE_REFUSAL_MUST_NOT_DELEGATE");
      },
      "docker",
      ["stop", containerId],
      { timeoutMs: 30_000, maxOutputBytes: 1024, environment: {} },
      {
        check: async () => refuseDockerDispatch("SUPERVISOR_CANCELLED"),
        assertTime: () => {},
      },
      () => {},
    );
    assert.equal(candidateProof.kind, "KNOWN_NOT_DISPATCHED");
    if (candidateProof.kind !== "KNOWN_NOT_DISPATCHED")
      throw new Error("missing candidate proof");
    assert.equal(candidateProof.attemptId, rowA.attemptId);
    await assert.rejects(
      journal!.notDispatched(reservationA!, candidateProof),
      /LEASE_RESULT_HISTORY_INVALID/,
    );
    assert.equal(journal!.unresolvedDestructive, true);
    const reservationB = await journal!.reserve(rowA.grantDigest, "stop", true);
    const outcomeB = await journal!.dispatchCommand(
      reservationB,
      async () => {
        throw new Error("REFUSED_B_MUST_NOT_DELEGATE");
      },
      "docker",
      ["stop", containerId],
      { timeoutMs: 30_000, maxOutputBytes: 1024, environment: {} },
      {
        check: async () => refuseDockerDispatch("SUPERVISOR_CANCELLED"),
        assertTime: () => {},
      },
      () => {},
    );
    assert.equal(outcomeB.kind, "KNOWN_NOT_DISPATCHED");
    if (outcomeB.kind !== "KNOWN_NOT_DISPATCHED")
      throw new Error("missing first-use refusal proof");
    await assert.rejects(
      journal!.notDispatched(reservationA!, outcomeB),
      /LEASE_RESULT_HISTORY_INVALID/,
    );
    assert.equal(journal!.unresolvedDestructive, true);
    const laterReservation = await journal.reserve(
      rowA.grantDigest,
      "stop",
      true,
    );
    const laterOutcome = await journal.dispatchCommand(
      laterReservation,
      async () => {
        throw new Error("synthetic later dispatch uncertainty");
      },
      "synthetic-never-executed",
      ["stop", containerId],
      { timeoutMs: 30_000, maxOutputBytes: 1024, environment: {} },
      undefined,
      () => {},
    );
    assert.equal(laterOutcome.kind, "UNCERTAIN");
    await assert.rejects(
      journal.notDispatched(laterReservation, outcomeB),
      /LEASE_RESULT_HISTORY_INVALID/,
    );
    await journal!.notDispatched(reservationB, outcomeB);
    const rowsAfterB = (await journalText(value.directory))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            event: string;
            seq: number;
            reservation?: number;
            attemptId?: string;
            ordinal?: number;
            reason?: string;
            provenance?: string;
          },
      );
    const rowB = rowsAfterB.find(
      (row) =>
        row.event === "COMMAND_NOT_DISPATCHED" &&
        row.reservation === reservationB,
    );
    const reservedA = rowsBeforeB.find(
      (row) => row.event === "COMMAND_RESERVED" && row.seq === reservationA,
    );
    const reservedB = rowsAfterB.find(
      (row) => row.event === "COMMAND_RESERVED" && row.seq === reservationB,
    );
    assert.ok(reservedA);
    assert.ok(reservedA.attemptId);
    assert.ok(reservedB);
    assert.ok(reservedB.attemptId);
    assert.notEqual(reservedA.attemptId, reservedB.attemptId);
    assert.equal(rowB?.attemptId, reservedB.attemptId);
    assert.equal(rowB?.attemptId, outcomeB.attemptId);
    assert.equal(rowB?.reason, "SUPERVISOR_CANCELLED");
    assert.equal(rowB?.provenance, "TRUSTED_PRE_DISPATCH_GATE");
    assert.equal(reservedB.ordinal, (reservedA.ordinal ?? 0) + 1);
    assert.equal(
      rowsAfterB.filter((row) => row.event === "GRANT_BOUND").length,
      1,
    );
    await assert.rejects(
      journal!.notDispatched(reservationB, outcomeB),
      /LEASE_RESERVATION_UNAVAILABLE/,
    );
    await assert.rejects(
      journal!.notDispatched(reservationA!, {
        ...outcomeB,
        attemptId: "44444444-4444-4444-8444-444444444444",
      }),
      /LEASE_RESULT_HISTORY_INVALID/,
    );
    assert.equal(journal!.unresolvedDestructive, true);
    const callsBeforeRedispatch = value.transportState.calls.length;
    const reused = await journal!.dispatchCommand(
      reservationA!,
      async () => {
        throw new Error("USED_ATTEMPT_MUST_NOT_DISPATCH");
      },
      "docker",
      ["stop", containerId],
      { timeoutMs: 30_000, maxOutputBytes: 1024, environment: {} },
      {
        check: async () => refuseDockerDispatch("SUPERVISOR_CANCELLED"),
        assertTime: () => {},
      },
      () => {},
    );
    assert.equal(reused.kind, "UNCERTAIN");
    if (reused.kind !== "UNCERTAIN")
      throw new Error("used attempt unexpectedly dispatched");
    assert.equal(reused.provenance, "INVALID_DISPATCH_ATTEMPT");
    assert.equal(value.transportState.calls.length, callsBeforeRedispatch);
    value.checkpoint = await lease!.closeSupervisor();
    const afterClose = await journalText(value.directory);
    const aRecord = afterClose
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            event: string;
            seq: number;
            reservation?: number;
          },
      )
      .filter((row) => row.reservation === reservationA);
    assert.equal(
      aRecord.some(
        (row) =>
          row.event === "COMMAND_NOT_DISPATCHED" ||
          row.event === "COMMAND_RESULT",
      ),
      false,
    );
    const reloaded = await recover(value);
    assert.equal(reloaded.lease.status, "INCOMPLETE");
    const callsBefore = value.transportState.calls.length;
    const cleanup = await fixtureCleanup(reloaded, value.payload());
    assert.equal(cleanup.status, "INCOMPLETE");
    assert.ok(
      cleanup.failures.some(
        (failure) => failure.code === "UNRESOLVED_DESTRUCTIVE_COMMAND",
      ),
    );
    assert.equal(value.transportState.calls.length, callsBefore);
    await reloaded.closeSupervisor();
  }));

test("refusal proof is bound to its journal and complete lease identity", async () =>
  fixture(async (value) => {
    const firstRoot = join(value.directory, "journal-first");
    const secondRoot = join(value.directory, "journal-second");
    const foreignRoot = join(value.directory, "journal-foreign");
    const foreignRunRoot = join(value.directory, "journal-foreign-run");
    const foreignTokenRoot = join(value.directory, "journal-foreign-token");
    const first = await LeaseJournal.create(
      firstRoot,
      { owner, runId, token },
      () => currentTime,
    );
    const second = await LeaseJournal.create(
      secondRoot,
      { owner, runId, token },
      () => currentTime,
    );
    const foreign = await LeaseJournal.create(
      foreignRoot,
      {
        owner: "55555555-5555-4555-8555-555555555555",
        runId,
        token,
      },
      () => currentTime,
    );
    const foreignRun = await LeaseJournal.create(
      foreignRunRoot,
      { owner, runId: "55555555-5555-4555-8555-555555555555", token },
      () => currentTime,
    );
    const foreignToken = await LeaseJournal.create(
      foreignTokenRoot,
      { owner, runId, token: "66666666-6666-4666-8666-666666666666" },
      () => currentTime,
    );
    const digest = "a".repeat(64);
    for (const journal of [first, second, foreign, foreignRun, foreignToken])
      await journal.bindGrant(digest, 3, currentTime + 60_000);
    const firstReservation = await first.reserve(digest, "stop", true);
    const secondReservation = await second.reserve(digest, "stop", true);
    const foreignReservation = await foreign.reserve(digest, "stop", true);
    const foreignRunReservation = await foreignRun.reserve(
      digest,
      "stop",
      true,
    );
    const foreignTokenReservation = await foreignToken.reserve(
      digest,
      "stop",
      true,
    );
    assert.equal(firstReservation, secondReservation);
    assert.equal(secondReservation, foreignReservation);
    assert.equal(firstReservation, foreignRunReservation);
    assert.equal(firstReservation, foreignTokenReservation);
    const outcome = await second.dispatchCommand(
      secondReservation,
      async () => {
        throw new Error("REFUSAL_MUST_NOT_DELEGATE");
      },
      "docker",
      ["stop", containerId],
      { timeoutMs: 30_000, maxOutputBytes: 1024, environment: {} },
      {
        check: async () => refuseDockerDispatch("SUPERVISOR_CANCELLED"),
        assertTime: () => {},
      },
      () => {},
    );
    assert.equal(outcome.kind, "KNOWN_NOT_DISPATCHED");
    if (outcome.kind !== "KNOWN_NOT_DISPATCHED")
      throw new Error("missing journal-bound refusal proof");
    await assert.rejects(
      first.notDispatched(firstReservation, outcome),
      /LEASE_RESULT_HISTORY_INVALID/,
    );
    await assert.rejects(
      foreign.notDispatched(foreignReservation, outcome),
      /LEASE_RESULT_HISTORY_INVALID/,
    );
    await assert.rejects(
      foreignRun.notDispatched(foreignRunReservation, outcome),
      /LEASE_RESULT_HISTORY_INVALID/,
    );
    await assert.rejects(
      foreignToken.notDispatched(foreignTokenReservation, outcome),
      /LEASE_RESULT_HISTORY_INVALID/,
    );
    await second.notDispatched(secondReservation, outcome);
    await first.close({});
    await second.close({});
    await foreign.close({});
    await foreignRun.close({});
    await foreignToken.close({});
  }));

test("actual journal append I/O failure poisons the lease and prevents retry or release", async () =>
  fixture(async (value) => {
    const originalDirectory = join(value.directory, owner);
    const movedDirectory = join(value.directory, "temporarily-unavailable");
    let moved = false;
    const lease = await recover(value, {
      beforeDispatch: {
        check: async (_exe, args) => {
          if (args[2] !== "stop") return;
          // Only this disposable fixture directory moves; the reserved bytes remain intact.
          await rename(originalDirectory, movedDirectory);
          moved = true;
          refuseDockerDispatch("SUPERVISOR_CANCELLED");
        },
        assertTime: () => {},
      },
    });
    try {
      await assert.rejects(
        fixtureCleanup(lease, value.payload()),
        /LEASE_JOURNAL_UNAVAILABLE/,
      );
    } finally {
      if (moved) await rename(movedDirectory, originalDirectory);
    }
    assert.equal(
      value.transportState.calls.some((args) => args[0] === "stop"),
      false,
    );
    const rows = (await journalText(value.directory))
      .trimEnd()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            event: string;
            command?: string;
            seq: number;
            reservation?: number;
          },
      );
    const pending = rows.find(
      (row) => row.event === "COMMAND_RESERVED" && row.command === "stop",
    );
    assert.ok(pending);
    assert.equal(
      rows.some(
        (row) =>
          row.reservation === pending.seq &&
          (row.event === "COMMAND_RESULT" ||
            row.event === "COMMAND_NOT_DISPATCHED"),
      ),
      false,
    );
    const callsBefore = value.transportState.calls.length;
    await assert.rejects(
      fixtureCleanup(lease, value.payload()),
      /LEASE_JOURNAL_UNAVAILABLE/,
    );
    await assert.rejects(lease.closeSupervisor(), /LEASE_JOURNAL_UNAVAILABLE/);
    await assert.rejects(
      recover(value),
      /LEASE_CHECKPOINT_STALE_OR_UNRECONCILED/,
    );
    assert.equal(value.transportState.calls.length, callsBefore);
  }));

test("legacy v2 expiry evidence reloads without provenance and without refunding its budget", async () =>
  fixture(async (value) => {
    const root = join(value.directory, "legacy-v2");
    const journal = await LeaseJournal.create(
      root,
      { owner, runId, token },
      () => currentTime,
    );
    const digest = "e".repeat(64);
    await journal.bindGrant(digest, 2, currentTime + 60_000);
    const first = await journal.event("COMMAND_RESERVED", {
      grantDigest: digest,
      ordinal: 1,
      command: "stop",
      destructive: true,
    });
    const checkpoint = await journal.close({});
    // Reproduce a pre-remediation row in the disposable journal bytes and hash chain.
    const journalPath = join(root, owner, "journal.jsonl");
    const rows = (await readFile(journalPath, "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as Record<string, unknown> & {
            seq: number;
            hash: string;
            session: string;
          },
      );
    const released = rows.pop();
    assert.ok(released);
    const previous = rows.at(-1);
    assert.ok(previous);
    const refusalBody = {
      version: 2,
      seq: released.seq,
      time: currentTime,
      event: "COMMAND_NOT_DISPATCHED",
      owner,
      runId,
      token,
      session: released.session,
      previousSha256: previous.hash,
      reservation: first,
      uncertain: false,
      reason: "AUTHORITY_EXPIRED_BEFORE_DISPATCH",
    };
    const refusal = {
      ...refusalBody,
      hash: hash(canonical(refusalBody)),
    };
    const { hash: releasedHash, ...releasedBody } = released;
    assert.match(releasedHash, /^[a-f0-9]{64}$/);
    const replacementBody = {
      ...releasedBody,
      seq: released.seq + 1,
      time: currentTime,
      previousSha256: refusal.hash,
    };
    const replacement = {
      ...replacementBody,
      hash: hash(canonical(replacementBody)),
    };
    await writeFile(
      journalPath,
      `${[...rows, refusal, replacement]
        .map((row) => JSON.stringify(row))
        .join("\n")}\n`,
    );
    const legacyCheckpoint = {
      ...checkpoint,
      journalSha256: replacement.hash,
    };
    const recovered = await LeaseJournal.recover(
      root,
      legacyCheckpoint,
      () => currentTime,
    );
    assert.equal(recovered.unresolvedDestructive, false);
    await recovered.reserve(digest, "stop", true);
    await assert.rejects(
      recovered.reserve(digest, "stop", true),
      /CLEANUP_GRANT_EXHAUSTED/,
    );
    await recovered.close({});
  }));

test("closed and superseded attempts cannot commit an unused refusal proof", async () =>
  fixture(async (value) => {
    for (const transition of ["closed", "superseded"] as const) {
      const root = join(value.directory, transition);
      const journal = await LeaseJournal.create(
        root,
        { owner, runId, token },
        () => currentTime,
      );
      const digest = "b".repeat(64);
      await journal.bindGrant(digest, 2, currentTime + 60_000);
      const reservation = await journal.reserve(digest, "stop", true);
      const proof = await journal.dispatchCommand(
        reservation,
        async () => {
          throw new Error("REFUSAL_MUST_NOT_DELEGATE");
        },
        "synthetic-never-executed",
        ["stop"],
        { timeoutMs: 30_000, maxOutputBytes: 1024, environment: {} },
        {
          check: async () => refuseDockerDispatch("SUPERVISOR_CANCELLED"),
          assertTime: () => {},
        },
        () => {},
      );
      assert.equal(proof.kind, "KNOWN_NOT_DISPATCHED");
      if (proof.kind !== "KNOWN_NOT_DISPATCHED")
        throw new Error("missing unused proof");
      if (transition === "closed") {
        const checkpoint = await journal.close({});
        await assert.rejects(
          journal.notDispatched(reservation, proof),
          /LEASE_JOURNAL_UNAVAILABLE/,
        );
        const recovered = await LeaseJournal.recover(
          root,
          checkpoint,
          () => currentTime,
        );
        await assert.rejects(
          recovered.notDispatched(reservation, proof),
          /LEASE_RESERVATION_UNAVAILABLE/,
        );
        assert.equal(recovered.unresolvedDestructive, true);
        await recovered.close({});
      } else {
        const replacement = "c".repeat(64);
        await journal.bindGrant(replacement, 2, currentTime + 60_000);
        await assert.rejects(
          journal.notDispatched(reservation, proof),
          /LEASE_RESERVATION_UNAVAILABLE/,
        );
        const next = await journal.reserve(replacement, "stop", true);
        await assert.rejects(
          journal.notDispatched(next, proof),
          /LEASE_RESULT_HISTORY_INVALID/,
        );
        assert.equal(journal.unresolvedDestructive, true);
        await journal.close({});
      }
    }
  }));
