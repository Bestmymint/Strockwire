import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import type {
  ApprovedSupervisorMessage,
  SupervisorChannel,
  SupervisorPlan,
  SupervisorStatus,
} from "./windows-supervisor-protocol.mts";
import { canonicalSupervisorValue } from "./windows-supervisor-protocol.mts";
import type {
  SupervisorLease,
  SupervisorPorts,
} from "./windows-supervisor-session.mts";
import { runSupervisorSession } from "./windows-supervisor-session.mts";
import type { Lease } from "./windows-resources.mts";
import type { JournalCheckpoint } from "./windows-lease-journal.mts";

const id = () => randomUUID();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const leaseId = id();
const runId = id();
const token = id();
const sourceSha256 = "a".repeat(64);
const migrationSha256 = "b".repeat(64);
const journalDirectory = "C:\\synthetic\\journal";
const checkpoint: JournalCheckpoint = {
  owner: leaseId,
  runId,
  token,
  journalSha256: "c".repeat(64),
};
const request = {
  operation: "acquire",
  leaseId,
  journalDirectory,
  operator: "operator-fixture",
  endpoint: "npipe:////./pipe/docker_engine",
  daemonId: "daemon-fixture",
  image: "postgres:16.15-alpine@sha256:" + "e".repeat(64),
  resolvedImageId: "sha256:" + "d".repeat(64),
  files: [],
  requiredTests: [],
};
const requestBytes = JSON.stringify(request);
const nowStart = 1_800_000_000_000;
function plan(
  mode: "acquire-bootstrap" | "cleanup-only" = "acquire-bootstrap",
): SupervisorPlan {
  return {
    contract: "D5-WINDOWS-SUPERVISOR-v1",
    sessionId: id(),
    mode,
    candidateRoot: "C:\\candidate",
    requestBytes,
    requestSha256: hash(requestBytes),
    sourceSha256,
    migrationSha256,
    channelDirectory: "C:\\channel",
    approvalDirectory: "C:\\approval",
    evidenceDirectory: "C:\\evidence",
    timeoutMs: 1000,
    checkpoint: mode === "cleanup-only" ? checkpoint : null,
  };
}
function digestInput(
  operation: "acquire" | "bootstrap" | "cleanup",
  extra: Record<string, unknown> = {},
) {
  return {
    commandTimeoutMs: 30_000,
    daemonId: request.daemonId,
    endpoint: request.endpoint,
    expiresAt: nowStart + 60_000,
    image: request.image,
    journalDirectory,
    maxCommands: 10,
    migrationSha256,
    operation,
    operator: request.operator,
    owner: leaseId,
    resolvedImageId: request.resolvedImageId,
    sourceSha256,
    ...extra,
  };
}
function approved(
  p: SupervisorPlan,
  operation: "acquire" | "bootstrap" | "cleanup",
  sequence: number,
  input?: Record<string, unknown>,
): ApprovedSupervisorMessage {
  const digestInputValue = input ?? digestInput(operation);
  return {
    message: {
      contract: "D5-WINDOWS-COMMAND-v1",
      sessionId: p.sessionId,
      sequence,
      operation,
      grant: {
        contract: operation === "cleanup" ? "G3-D" : "G3-C",
        digestInput: digestInputValue,
      },
    },
    grantSha256: hash(canonicalSupervisorValue(digestInputValue)),
  };
}
function fakeLease(
  options: {
    bootstrapError?: Error;
    failures?: number;
    onCleanup?: () => void;
  } = {},
): SupervisorLease {
  const failures = options.failures
    ? [
        {
          sequence: 1,
          timestamp: nowStart,
          category: "BOOTSTRAP" as const,
          code: "FIXTURE_FAILURE",
          evidence: {},
        },
      ]
    : [];
  let current: Lease = {
    owner: leaseId,
    runId,
    token,
    journalDirectory,
    containerName: "pg-fixture",
    containerId: "1".repeat(64),
    networkName: "net-fixture",
    networkId: "2".repeat(64),
    volumeName: "volume-fixture",
    volumeBirth: "birth-fixture",
    status: "ACQUIRED",
    failureCount: failures.length,
    failures,
    verdict: failures.length ? "FAIL" : "INCOMPLETE",
  };
  return {
    get lease() {
      return { ...current, failures: [...current.failures] };
    },
    async bootstrap() {
      if (options.bootstrapError) {
        const failure = {
          sequence: current.failureCount + 1,
          timestamp: nowStart,
          category: "BOOTSTRAP" as const,
          code: "FIXTURE_FAILURE",
          evidence: {},
        };
        current = {
          ...current,
          failureCount: current.failureCount + 1,
          failures: [...current.failures, failure],
          verdict: "FAIL",
        };
        throw options.bootstrapError;
      }
      return {
        database: "db-fixture",
        user: "user-fixture",
        clusterIdentity: "cluster-fixture",
      };
    },
    async cleanup() {
      options.onCleanup?.();
      current = {
        ...current,
        status: "CLEAN",
        verdict: current.failureCount ? "FAIL" : "PASS",
      };
      return current;
    },
    async closeSupervisor() {
      current = { ...current, status: "INCOMPLETE" };
      return checkpoint;
    },
  };
}
function harness(
  _plan: SupervisorPlan,
  responses: Array<ApprovedSupervisorMessage | null>,
  options: {
    start?: number;
    liveError?: Error;
    verifyError?: Error;
    acquireError?: Error;
    bootstrapError?: Error;
    cleanupError?: Error;
    recoverError?: Error;
    statusError?: Error;
    checkpointError?: Error;
    onSleep?: () => void;
    onCleanup?: () => void;
  } = {},
) {
  let clock = options.start ?? nowStart;
  const calls: string[] = [];
  const statuses: SupervisorStatus[] = [];
  const saved: JournalCheckpoint[] = [];
  const sameLease = fakeLease(options);
  let active = false;
  const channel: SupervisorChannel = {
    async assertLive() {
      calls.push("live");
      if (options.liveError) throw options.liveError;
    },
    async next(sequence) {
      calls.push(`next:${sequence}`);
      return responses.shift() ?? null;
    },
    async status(value) {
      calls.push(`status:${value.state}`);
      statuses.push(value);
      if (options.statusError) throw options.statusError;
    },
    async checkpoint(value) {
      calls.push("checkpoint");
      saved.push(value);
      if (options.checkpointError) throw options.checkpointError;
    },
    async close() {
      calls.push("close");
      assert.equal(
        active,
        false,
        "channel must not close during resource operation",
      );
    },
  };
  const ports: SupervisorPorts = {
    channel,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      options.onSleep?.();
    },
    async verify() {
      calls.push("verify");
      if (options.verifyError) throw options.verifyError;
    },
    async acquire(_grant, _pin, guard) {
      calls.push("acquire");
      await guard();
      active = true;
      try {
        if (options.acquireError) throw options.acquireError;
        return sameLease;
      } finally {
        active = false;
      }
    },
    async recover(_checkpoint, guard) {
      calls.push("recover");
      await guard();
      active = true;
      try {
        if (options.recoverError) throw options.recoverError;
        return sameLease;
      } finally {
        active = false;
      }
    },
  };
  return {
    calls,
    statuses,
    saved,
    sameLease,
    ports,
    channel,
    now: () => clock,
  };
}

test("startup remains inert without authority and rejects malformed approval before dispatch", async () => {
  const p = plan();
  const empty = harness(p, []);
  const result = await runSupervisorSession(p, empty.ports);
  assert.equal(result.state, "FAILED");
  assert.equal(result.verdict, "FAIL");
  assert.deepEqual(
    empty.calls.filter((call) => call === "acquire" || call === "recover"),
    [],
  );
  const bad = harness(p, [
    { ...approved(p, "acquire", 1), grantSha256: "0".repeat(64) },
  ]);
  const rejected = await runSupervisorSession(p, bad.ports);
  assert.equal(rejected.state, "FAILED");
  assert.equal(bad.calls.includes("acquire"), false);
  assert.equal(bad.calls.at(-1), "close");
});

test("acquire and bootstrap preserve the exact lease instance and enforce scoped transition", async () => {
  const p = plan();
  const first = approved(p, "acquire", 1);
  const resources = {
    token,
    containerId: "1".repeat(64),
    containerName: "pg-fixture",
    networkId: "2".repeat(64),
    networkName: "net-fixture",
    volumeName: "volume-fixture",
    volumeBirth: "birth-fixture",
  };
  const second = approved(
    p,
    "bootstrap",
    2,
    digestInput("bootstrap", { runId, resources }),
  );
  const h = harness(p, [first, second]);
  let usedOriginalInstance = false;
  h.sameLease.bootstrap = async function () {
    usedOriginalInstance = this === h.sameLease;
    h.calls.push("bootstrap");
    return {
      database: "db-fixture",
      user: "user-fixture",
      clusterIdentity: "cluster-fixture",
    };
  };
  const result = await runSupervisorSession(p, h.ports);
  assert.equal(usedOriginalInstance, true);
  assert.equal(h.calls.filter((call) => call === "acquire").length, 1);
  assert.equal(h.calls.filter((call) => call === "bootstrap").length, 1);
  assert.equal(h.calls.includes("recover"), false);
  assert.equal(
    h.statuses.find((status) => status.state === "ACQUIRING")?.cleanup,
    "INCOMPLETE",
  );
  assert.equal(result.state, "RELEASED");
  assert.equal(result.cleanup, "INCOMPLETE");
});

test("wrong scope, expiry, sequence/replay and illegal transitions never reach unsafe adapter operations", async () => {
  const cases: Array<(p: SupervisorPlan) => ApprovedSupervisorMessage> = [
    (p) =>
      approved(p, "acquire", 1, { ...digestInput("acquire"), owner: id() }),
    (p) =>
      approved(p, "acquire", 1, {
        ...digestInput("acquire"),
        expiresAt: nowStart,
      }),
    (p) =>
      approved(p, "acquire", 1, {
        ...digestInput("acquire"),
        sourceSha256: "f".repeat(64),
      }),
    (p) =>
      approved(p, "acquire", 1, {
        ...digestInput("acquire"),
        image: "postgres:wrong",
      }),
    (p) =>
      approved(
        p,
        "bootstrap",
        1,
        digestInput("bootstrap", { runId, resources: {} }),
      ),
    (p) => approved(p, "acquire", 2),
  ];
  for (const make of cases) {
    const p = plan();
    const h = harness(p, [make(p)]);
    const result = await runSupervisorSession(p, h.ports);
    assert.equal(result.state, "FAILED");
    assert.equal(
      h.calls.some((call) => call === "acquire" || call === "recover"),
      false,
    );
  }
  for (const invalid of [
    {
      runId: id(),
      resources: {
        token,
        containerId: "1".repeat(64),
        containerName: "pg-fixture",
        networkId: "2".repeat(64),
        networkName: "net-fixture",
        volumeName: "volume-fixture",
        volumeBirth: "birth-fixture",
      },
    },
    {
      runId,
      resources: {
        token,
        containerId: "f".repeat(64),
        containerName: "pg-fixture",
        networkId: "2".repeat(64),
        networkName: "net-fixture",
        volumeName: "volume-fixture",
        volumeBirth: "birth-fixture",
      },
    },
  ]) {
    const p = plan();
    const h = harness(p, [
      approved(p, "acquire", 1),
      approved(p, "bootstrap", 2, digestInput("bootstrap", invalid)),
    ]);
    const result = await runSupervisorSession(p, h.ports);
    assert.equal(result.cleanup, "INCOMPLETE");
    assert.equal(
      h.statuses.some((status) => status.state === "BOOTSTRAPPING"),
      false,
    );
    assert.equal(h.saved.length, 1);
  }
  const failedPlan = plan();
  const resources = {
    token,
    containerId: "1".repeat(64),
    containerName: "pg-fixture",
    networkId: "2".repeat(64),
    networkName: "net-fixture",
    volumeName: "volume-fixture",
    volumeBirth: "birth-fixture",
  };
  const failed = harness(
    failedPlan,
    [
      approved(failedPlan, "acquire", 1),
      approved(
        failedPlan,
        "bootstrap",
        2,
        digestInput("bootstrap", { runId, resources }),
      ),
    ],
    { bootstrapError: new Error("fixture bootstrap failure") },
  );
  const failedOutcome = await runSupervisorSession(failedPlan, failed.ports);
  assert.equal(failedOutcome.verdict, "FAIL");
  assert.equal(failed.saved.length, 1);
  const replayPlan = plan();
  const replay = harness(replayPlan, [
    approved(replayPlan, "acquire", 1),
    approved(replayPlan, "acquire", 1),
  ]);
  const replayResult = await runSupervisorSession(replayPlan, replay.ports);
  assert.notEqual(replayResult.verdict, "PASS");
});

test("deadline, cancellation and disconnect preserve held checkpoint without automatic cleanup", async () => {
  for (const failure of ["cancel", "disconnect", "deadline"] as const) {
    const p = plan();
    const acquisition = approved(p, "acquire", 1);
    const h = harness(p, [acquisition, null]);
    h.channel.assertLive = async () => {
      h.calls.push("live");
      if (!h.statuses.some((status) => status.state === "ACQUIRED")) return;
      if (failure === "cancel") throw new Error("SUPERVISOR_CANCELLED");
      if (failure === "disconnect") throw new Error("SUPERVISOR_DISCONNECTED");
    };
    if (failure === "deadline")
      h.ports.now = () =>
        h.statuses.some((status) => status.state === "ACQUIRED")
          ? nowStart + 1000
          : nowStart;
    const result = await runSupervisorSession(p, h.ports);
    assert.equal(
      h.saved.length,
      1,
      "held lease must be checkpointed on interruption",
    );
    assert.deepEqual(result.checkpoint, checkpoint);
    assert.notEqual(result.verdict, "PASS");
    assert.equal(h.calls.includes("cleanup"), false);
    assert.equal(h.calls.includes("recover"), false);
    assert.equal(h.calls.at(-1), "close");
  }
});

test("cleanup-only accepts only exact G3-D authorization and performs recover then cleanup", async () => {
  const p = plan("cleanup-only");
  const resources = {
    token,
    containerId: "1".repeat(64),
    containerName: "pg-fixture",
    networkId: "2".repeat(64),
    networkName: "net-fixture",
    volumeName: "volume-fixture",
    volumeBirth: "birth-fixture",
  };
  const input = digestInput("cleanup", {
    runId,
    resources,
    actions: [
      "stop-5s-then-force",
      "remove-container",
      "remove-network",
      "remove-volume",
    ],
    exclusiveWindow: "operator-prevents-concurrent-lease-mutation",
    volumeRace: "accept-non-atomic-volume-name-deletion",
  });
  let cleaned = false;
  const h = harness(p, [approved(p, "cleanup", 1, input)], {
    onCleanup: () => {
      cleaned = true;
    },
  });
  const result = await runSupervisorSession(p, {
    ...h.ports,
    recover: async (cp, guard) => {
      h.calls.push("recover");
      assert.equal(cp, checkpoint);
      await guard();
      return h.sameLease;
    },
  });
  assert.equal(cleaned, true);
  assert.equal(result.cleanup, "COMPLETE");
  assert.equal(result.verdict, "PASS");
});

test("cleanup-only rejects G3-C and prior acquisition failure is not erased by successful cleanup", async () => {
  const p = plan("cleanup-only");
  const h = harness(p, [approved(p, "acquire", 1)]);
  const refused = await runSupervisorSession(p, h.ports);
  assert.equal(refused.state, "FAILED");
  assert.equal(h.calls.includes("recover"), false);
  const q = plan("cleanup-only");
  const resources = {
    token,
    containerId: "1".repeat(64),
    containerName: "pg-fixture",
    networkId: "2".repeat(64),
    networkName: "net-fixture",
    volumeName: "volume-fixture",
    volumeBirth: "birth-fixture",
  };
  const input = digestInput("cleanup", {
    runId,
    resources,
    actions: [
      "stop-5s-then-force",
      "remove-container",
      "remove-network",
      "remove-volume",
    ],
    exclusiveWindow: "operator-prevents-concurrent-lease-mutation",
    volumeRace: "accept-non-atomic-volume-name-deletion",
  });
  const r = harness(q, [approved(q, "cleanup", 1, input)]);
  const failedLease = fakeLease({ failures: 1 });
  const priorFailure = await runSupervisorSession(q, {
    ...r.ports,
    recover: async (_cp, guard) => {
      await guard();
      return failedLease;
    },
  });
  assert.equal(priorFailure.cleanup, "COMPLETE");
  assert.equal(priorFailure.verdict, "FAIL");
});

test("verification and checkpoint persistence failures remain fail-closed", async () => {
  const p = plan();
  const startup = harness(p, [], { verifyError: new Error("fixture failure") });
  const initial = await runSupervisorSession(p, startup.ports);
  assert.equal(initial.state, "FAILED");
  assert.equal(startup.calls.at(-1), "close");

  const q = plan();
  const interrupted = harness(q, [approved(q, "acquire", 1), null], {
    checkpointError: new Error("fixture failure"),
  });
  interrupted.channel.assertLive = async () => {
    interrupted.calls.push("live");
    if (interrupted.statuses.some((status) => status.state === "ACQUIRED"))
      throw new Error("SUPERVISOR_CANCELLED");
  };
  const incomplete = await runSupervisorSession(q, interrupted.ports);
  assert.equal(incomplete.state, "FAILED");
  assert.equal(incomplete.verdict, "FAIL");
  assert.equal(interrupted.calls.includes("cleanup"), false);
  assert.equal(interrupted.calls.at(-1), "close");
});

test("uncertain acquisition is checkpointed without publishing acquired or waiting for bootstrap", async () => {
  const p = plan();
  const h = harness(p, [approved(p, "acquire", 1)]);
  const uncertain: SupervisorLease = {
    ...h.sameLease,
    get lease(): Lease {
      return { ...h.sameLease.lease, status: "UNCERTAIN" };
    },
  };
  h.ports.acquire = async (_grant, _pin, guard) => {
    await guard();
    return uncertain;
  };
  const result = await runSupervisorSession(p, h.ports);
  assert.equal(result.cleanup, "INCOMPLETE");
  assert.equal(result.verdict, "INCOMPLETE");
  assert.deepEqual(h.saved, [checkpoint]);
  assert.equal(
    h.statuses.some(
      (status) =>
        status.state === "ACQUIRED" || status.state === "WAITING_BOOTSTRAP",
    ),
    false,
  );
});

test("session and grant deadlines crossing asynchronous liveness reads refuse dispatch", async () => {
  for (const limit of ["session", "grant"] as const) {
    const p = plan();
    let clock = nowStart;
    let insideTransport = false;
    let dispatched = false;
    const expiresAt = nowStart + 500;
    const h = harness(p, [
      approved(p, "acquire", 1, digestInput("acquire", { expiresAt })),
    ]);
    h.ports.now = () => clock;
    h.channel.assertLive = async () => {
      if (insideTransport)
        clock = nowStart + (limit === "session" ? 1000 : 500);
    };
    h.ports.acquire = async (_grant, _pin, guard) => {
      insideTransport = true;
      await guard();
      guard.assertTime();
      dispatched = true;
      return h.sameLease;
    };
    const result = await runSupervisorSession(p, h.ports);
    assert.equal(dispatched, false);
    assert.equal(result.cleanup, "INCOMPLETE");
    assert.notEqual(result.verdict, "PASS");
  }
});
