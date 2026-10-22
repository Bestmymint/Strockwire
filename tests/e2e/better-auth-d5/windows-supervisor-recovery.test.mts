import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
} from "./windows-resources.mts";
import {
  canonicalSupervisorValue,
  type SupervisorPlan,
} from "./windows-supervisor-protocol.mts";
import { runSupervisorSession } from "./windows-supervisor-session.mts";
import { createDockerCliFixture } from "./windows-docker-cli.fixture.mts";
import { windowsDockerCliBinding } from "./windows-docker-cli.mts";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

test("submitted cleanup identity rejection survives actual journal release and recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "d5-supervisor-recovery-"));
  const now = Date.now();
  const owner = randomUUID(),
    runId = randomUUID(),
    token = randomUUID();
  const source = "a".repeat(64),
    containerId = "b".repeat(64),
    networkId = "c".repeat(64);
  const stem = `sw-d5-${owner}`;
  let dockerCalls = 0;
  const options: CleanupRecoveryOptions = {
    leaseId: owner,
    journalDirectory: directory,
    environment: {},
    sourceSha256: source,
    migrationSha256: source,
    expectedSourceSha256: source,
    expectedMigrationSha256: source,
    endpoint: WINDOWS_DOCKER_ENDPOINT,
    daemonId: "synthetic-daemon",
    operator: "synthetic-operator",
    image: `postgres:16.15-alpine@sha256:${"d".repeat(64)}`,
    resolvedImageId: `sha256:${"e".repeat(64)}`,
    dockerCli: createDockerCliFixture(directory).approval,
    now: () => now,
    transport: async () => {
      dockerCalls += 1;
      throw new Error("NO_REAL_TRANSPORT");
    },
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
    volumeBirth: "synthetic-birth",
    status: "ACQUIRED",
  };
  const configuration = {
    endpoint: options.endpoint,
    daemonId: options.daemonId,
    sourceSha256: source,
    migrationSha256: source,
    image: options.image,
    resolvedImageId: options.resolvedImageId,
    journalDirectory: directory,
    operatorSha256: hash(options.operator),
    dockerCli: windowsDockerCliBinding(options.dockerCli),
  };
  const resources = [
    {
      kind: "volume",
      name: state.volumeName,
      identity: state.volumeBirth,
      confirmed: true,
      attempted: true,
    },
    {
      kind: "network",
      name: state.networkName,
      identity: networkId,
      confirmed: true,
      attempted: true,
    },
    {
      kind: "container",
      name: state.containerName,
      identity: containerId,
      confirmed: true,
      attempted: true,
    },
  ];
  try {
    // Synthetic positive acquisition HISTORY only. No resource adapter acquire or transport executes.
    const journal = await LeaseJournal.create(
      directory,
      { owner, runId, token },
      () => now,
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
    const checkpoint = await journal.close({
      state,
      configuration,
      resources,
      failureCount: 0,
    });
    const requestBytes = JSON.stringify({
      operation: "acquire",
      leaseId: owner,
      journalDirectory: directory,
      operator: options.operator,
      endpoint: options.endpoint,
      daemonId: options.daemonId,
      image: options.image,
      resolvedImageId: options.resolvedImageId,
      files: [],
      requiredTests: [],
    });
    const plan: SupervisorPlan = {
      contract: "D5-WINDOWS-SUPERVISOR-v1",
      sessionId: randomUUID(),
      mode: "cleanup-only",
      candidateRoot: "C:\\synthetic-candidate",
      requestBytes,
      requestSha256: hash(requestBytes),
      sourceSha256: source,
      migrationSha256: source,
      channelDirectory: "C:\\synthetic-channel",
      approvalDirectory: "C:\\synthetic-approval",
      evidenceDirectory: "C:\\synthetic-evidence",
      timeoutMs: 5000,
      checkpoint,
    };
    const payload = {
      operation: "cleanup",
      owner,
      runId,
      operator: options.operator,
      endpoint: options.endpoint,
      daemonId: options.daemonId,
      image: options.image,
      resolvedImageId: options.resolvedImageId,
      sourceSha256: source,
      migrationSha256: source,
      journalDirectory: directory,
      commandTimeoutMs: 30_000,
      maxCommands: 100,
      expiresAt: now + 60_000,
      resources: {
        token,
        containerId: "f".repeat(64),
        containerName: state.containerName,
        networkId,
        networkName: state.networkName,
        volumeName: state.volumeName,
        volumeBirth: state.volumeBirth,
      },
      actions: [
        "stop-5s-then-force",
        "remove-container",
        "remove-network",
        "remove-volume",
      ],
      exclusiveWindow: "operator-prevents-concurrent-lease-mutation",
      volumeRace: "accept-non-atomic-volume-name-deletion",
    };
    let saved: JournalCheckpoint | null = null;
    const outcome = await runSupervisorSession(plan, {
      now: () => now,
      sleep: async () => {},
      verify: async () => {},
      acquire: async () => {
        throw new Error("CLEANUP_ONLY");
      },
      recover: async (released) =>
        WindowsDockerLease.recoverCleanup(options, released),
      channel: {
        assertLive: async () => {},
        close: async () => {},
        status: async () => {},
        checkpoint: async (value) => {
          saved = value;
        },
        next: async (sequence) => ({
          message: {
            contract: "D5-WINDOWS-COMMAND-v1",
            sessionId: plan.sessionId,
            sequence,
            operation: "cleanup",
            grant: { contract: "G3-D", digestInput: payload },
          },
          grantSha256: hash(canonicalSupervisorValue(payload)),
        }),
      },
    });
    assert.equal(outcome.verdict, "FAIL");
    assert.equal(outcome.cleanup, "INCOMPLETE");
    assert.equal(dockerCalls, 0);
    assert.ok(saved);
    const recovered = await WindowsDockerLease.recoverCleanup(options, saved);
    assert.equal(recovered.lease.failureCount, 1);
    assert.equal(recovered.lease.verdict, "FAIL");
    assert.equal(
      recovered.lease.failures[0]?.code,
      "EXACT_RESOURCE_AUTHORIZATION_REQUIRED",
    );
    await recovered.closeSupervisor();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
