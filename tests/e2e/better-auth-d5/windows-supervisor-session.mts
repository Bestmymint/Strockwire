import { createHash } from "node:crypto";
import { refuseDockerDispatch } from "./windows-command-dispatch.mts";
import {
  assertWindowsBootstrapLeaseScope,
  parseWindowsResourceRequest,
  type WindowsResourceRequest,
} from "./windows-resource-invocation.mts";
import type { JournalCheckpoint } from "./windows-lease-journal.mts";
import type {
  OperatorGrant,
  WindowsDockerLease,
} from "./windows-resources.mts";
import {
  canonicalSupervisorValue,
  type ApprovedSupervisorMessage,
  type SupervisorChannel,
  type SupervisorIdentity,
  type SupervisorPlan,
  type SupervisorState,
  type SupervisorStatus,
} from "./windows-supervisor-protocol.mts";

export type SupervisorLease = Pick<
  WindowsDockerLease,
  "lease" | "bootstrap" | "cleanup" | "closeSupervisor"
>;
export interface SupervisorGuard {
  (): Promise<void>;
  assertTime(): void;
}
export interface SupervisorPorts {
  channel: SupervisorChannel;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  verify: () => Promise<void>;
  acquire: (
    grant: OperatorGrant,
    pin: string,
    guard: SupervisorGuard,
  ) => Promise<SupervisorLease>;
  recover: (
    checkpoint: JournalCheckpoint,
    guard: SupervisorGuard,
  ) => Promise<SupervisorLease>;
}
export interface SupervisorResult {
  state: "RELEASED" | "INCOMPLETE" | "FAILED";
  verdict: "PASS" | "FAIL" | "INCOMPLETE";
  cleanup: "NOT_RUN" | "INCOMPLETE" | "COMPLETE";
  checkpoint: JournalCheckpoint | null;
}
function refuse(): never {
  throw new Error("SUPERVISOR_GRANT_REFUSED");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
  return value as Record<string, unknown>;
}
function digest(value: unknown): string {
  return createHash("sha256")
    .update(canonicalSupervisorValue(value))
    .digest("hex");
}
const commonFields = [
  "commandTimeoutMs",
  "daemonId",
  "endpoint",
  "expiresAt",
  "image",
  "journalDirectory",
  "maxCommands",
  "migrationSha256",
  "operation",
  "operator",
  "owner",
  "resolvedImageId",
  "sourceSha256",
];

/** The inbox supplies data; only the separately delivered owner-review pin supplies authority. */
function validateGrant(
  approved: ApprovedSupervisorMessage,
  plan: SupervisorPlan,
  request: WindowsResourceRequest,
  now: number,
  lease: SupervisorLease | null,
): void {
  const { message, grantSha256 } = approved;
  const grant = message.grant;
  const payload = object(grant.digestInput);
  const operation = message.operation;
  const fields = [...commonFields];
  if (operation !== "acquire") fields.push("resources", "runId");
  if (operation === "cleanup")
    fields.push("actions", "exclusiveWindow", "volumeRace");
  if (
    message.contract !== "D5-WINDOWS-COMMAND-v1" ||
    message.sessionId !== plan.sessionId ||
    grant.contract !== (operation === "cleanup" ? "G3-D" : "G3-C") ||
    !/^[a-f0-9]{64}$/.test(grantSha256) ||
    digest(payload) !== grantSha256 ||
    Object.keys(payload).sort().join(",") !== fields.sort().join(",") ||
    payload.operation !== operation ||
    payload.owner !== request.leaseId ||
    payload.operator !== request.operator ||
    payload.endpoint !== request.endpoint ||
    payload.daemonId !== request.daemonId ||
    payload.image !== request.image ||
    payload.resolvedImageId !== request.resolvedImageId ||
    payload.journalDirectory !== request.journalDirectory ||
    payload.sourceSha256 !== plan.sourceSha256 ||
    payload.migrationSha256 !== plan.migrationSha256 ||
    payload.commandTimeoutMs !== 30_000 ||
    !Number.isSafeInteger(payload.maxCommands) ||
    (payload.maxCommands as number) < 1 ||
    (payload.maxCommands as number) > 1000 ||
    !Number.isSafeInteger(payload.expiresAt) ||
    (payload.expiresAt as number) <= now ||
    (payload.expiresAt as number) > now + 3_600_000
  )
    refuse();
  if (operation === "bootstrap") {
    if (!lease) refuse();
    assertWindowsBootstrapLeaseScope(payload, lease.lease);
  }
  if (operation === "cleanup") {
    const checkpoint = plan.checkpoint;
    if (
      !checkpoint ||
      payload.runId !== checkpoint.runId ||
      object(payload.resources).token !== checkpoint.token ||
      canonicalSupervisorValue(payload.actions) !==
        canonicalSupervisorValue([
          "stop-5s-then-force",
          "remove-container",
          "remove-network",
          "remove-volume",
        ]) ||
      payload.exclusiveWindow !==
        "operator-prevents-concurrent-lease-mutation" ||
      payload.volumeRace !== "accept-non-atomic-volume-name-deletion"
    )
      refuse();
  }
}
function identity(lease: SupervisorLease | null): SupervisorIdentity | null {
  if (!lease) return null;
  const value = lease.lease;
  return {
    owner: value.owner,
    runId: value.runId,
    token: value.token,
    containerName: value.containerName,
    containerId: value.containerId,
    networkName: value.networkName,
    networkId: value.networkId,
    volumeName: value.volumeName,
    volumeBirth: value.volumeBirth,
  };
}
function safeReason(error: unknown): string {
  if (error instanceof Error) {
    for (const code of [
      "SUPERVISOR_TIMEOUT",
      "SUPERVISOR_CANCELLED",
      "SUPERVISOR_DISCONNECTED",
      "SUPERVISOR_GRANT_REFUSED",
      "SUPERVISOR_TRANSITION_REFUSED",
      "SUPERVISOR_REPLAY_REFUSED",
      "SUPERVISOR_ACQUISITION_INCOMPLETE",
    ])
      if (error.message === code) return code;
  }
  return "SUPERVISOR_OPERATION_REFUSED";
}

/** A session owns one actual adapter instance. A checkpoint never recreates its bootstrap authority. */
export async function runSupervisorSession(
  plan: SupervisorPlan,
  ports: SupervisorPorts,
): Promise<SupervisorResult> {
  const request = parseWindowsResourceRequest(
    plan.requestBytes,
    plan.requestSha256,
  );
  const deadline = ports.now() + plan.timeoutMs;
  let held: SupervisorLease | null = null;
  let checkpoint: JournalCheckpoint | null = null;
  let cleanup: SupervisorResult["cleanup"] = "NOT_RUN";
  let state: SupervisorResult["state"] = "FAILED";
  let verdict: SupervisorResult["verdict"];
  let reason: string | null = null;
  let sequence = 1;
  let activeGrantExpiresAt = Number.POSITIVE_INFINITY;
  const seenGrants = new Set<string>();
  const publish = async (next: SupervisorState) => {
    const status: SupervisorStatus = {
      contract: "D5-WINDOWS-STATUS-v1",
      sessionId: plan.sessionId,
      leaseId: request.leaseId,
      state: next,
      reason,
      identity: identity(held),
      failureCount: held?.lease.failureCount ?? 0,
      cleanup,
      checkpointSha256: checkpoint?.journalSha256 ?? null,
    };
    await ports.channel.status(status);
  };
  const assertTime = () => {
    const now = ports.now();
    if (now >= deadline) refuseDockerDispatch("SUPERVISOR_TIMEOUT");
    if (now >= activeGrantExpiresAt)
      refuseDockerDispatch("SUPERVISOR_GRANT_REFUSED");
  };
  const guard: SupervisorGuard = Object.assign(
    async () => {
      assertTime();
      await ports.channel.assertLive();
      assertTime();
    },
    { assertTime },
  );
  try {
    if (
      request.operation !== "acquire" ||
      (plan.mode === "cleanup-only" &&
        (!plan.checkpoint || plan.checkpoint.owner !== request.leaseId)) ||
      (plan.mode === "acquire-bootstrap" && plan.checkpoint !== null)
    )
      throw new Error("SUPERVISOR_TRANSITION_REFUSED");
    await ports.verify();
    await publish("WAITING_APPROVAL");
    for (;;) {
      await guard();
      const approved = await ports.channel.next(sequence);
      if (!approved) {
        await ports.sleep(50);
        continue;
      }
      const { message } = approved;
      if (message.sequence !== sequence || seenGrants.has(approved.grantSha256))
        throw new Error("SUPERVISOR_REPLAY_REFUSED");
      const expected =
        plan.mode === "cleanup-only"
          ? "cleanup"
          : held
            ? "bootstrap"
            : "acquire";
      if (message.operation !== expected)
        throw new Error("SUPERVISOR_TRANSITION_REFUSED");
      validateGrant(approved, plan, request, ports.now(), held);
      activeGrantExpiresAt = object(message.grant.digestInput)
        .expiresAt as number;
      seenGrants.add(approved.grantSha256);
      sequence += 1;
      await ports.verify();
      await guard();
      if (message.operation === "acquire") {
        cleanup = "INCOMPLETE";
        await publish("ACQUIRING");
        // Persist expected lease/journal identities before acquire can create anything.
        held = await ports.acquire(message.grant, approved.grantSha256, guard);
        if (held.lease.status !== "ACQUIRED" || held.lease.failureCount !== 0)
          throw new Error("SUPERVISOR_ACQUISITION_INCOMPLETE");
        activeGrantExpiresAt = Number.POSITIVE_INFINITY;
        await publish("ACQUIRED");
        await guard();
        await publish("WAITING_BOOTSTRAP");
        continue;
      }
      if (message.operation === "bootstrap") {
        if (!held) throw new Error("SUPERVISOR_TRANSITION_REFUSED");
        await publish("BOOTSTRAPPING");
        // This is the exact original instance, never a serialized or cloned lease.
        await held.bootstrap(message.grant, {
          g3cSha256: approved.grantSha256,
        });
        verdict = "INCOMPLETE";
        state = "RELEASED";
        break;
      }
      if (!plan.checkpoint) throw new Error("SUPERVISOR_TRANSITION_REFUSED");
      await publish("RECOVERING");
      held = await ports.recover(plan.checkpoint, guard);
      cleanup = "INCOMPLETE";
      await guard();
      await publish("CLEANING");
      const result = await held.cleanup(message.grant, {
        g3dSha256: approved.grantSha256,
      });
      cleanup = result.status === "CLEAN" ? "COMPLETE" : "INCOMPLETE";
      verdict =
        result.status === "CLEAN" &&
        result.verdict === "PASS" &&
        result.failureCount === 0 &&
        result.failures.length === 0
          ? "PASS"
          : result.verdict === "FAIL" || result.failureCount > 0
            ? "FAIL"
            : "INCOMPLETE";
      state =
        verdict === "PASS"
          ? "RELEASED"
          : verdict === "FAIL"
            ? "FAILED"
            : "INCOMPLETE";
      break;
    }
  } catch (error) {
    reason = safeReason(error);
    state = held ? "INCOMPLETE" : "FAILED";
    verdict =
      held?.lease.verdict === "FAIL" ? "FAIL" : held ? "INCOMPLETE" : "FAIL";
  } finally {
    if (held && held.lease.status !== "CLEAN") {
      cleanup = "INCOMPLETE";
      try {
        // No resource deletion, command dispatch, or gate bypass on orderly release.
        checkpoint = await held.closeSupervisor();
        await ports.channel.checkpoint(checkpoint);
        if (state !== "FAILED") state = "RELEASED";
      } catch {
        reason = "SUPERVISOR_RELEASE_INCOMPLETE";
        state = "FAILED";
        verdict = "FAIL";
      }
    }
    try {
      if (reason && held) await publish("INCOMPLETE");
      await publish(state);
    } catch {
      state = "FAILED";
      verdict = "FAIL";
    }
    try {
      await ports.channel.close();
    } catch {
      state = "FAILED";
      verdict = "FAIL";
    }
  }
  return { state, verdict, cleanup, checkpoint };
}
