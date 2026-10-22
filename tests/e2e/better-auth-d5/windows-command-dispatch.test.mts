import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DockerCommandResult,
  DockerCommandTransport,
} from "./windows-resources.mts";
import {
  consumeDockerNonDispatch,
  createDockerDispatchAttempt,
  dispatchDockerCommand,
  refuseDockerDispatch,
  type DockerCommandOutcome,
  type DockerDispatchBinding,
  type DockerDispatchGate,
  type DockerDispatchRefusalReason,
} from "./windows-command-dispatch.mts";

const result: DockerCommandResult = {
  stdout: "ok",
  stderr: "",
  code: 0,
  signal: null,
  timedOut: false,
};
const options = {
  timeoutMs: 50,
  maxOutputBytes: 1024,
  environment: {},
} as const;
const neverGate: DockerDispatchGate = {
  check: async () => {},
  assertTime: () => {},
};
const noAuthorityFailure = () => {};
const transportReturning =
  (value: unknown): DockerCommandTransport =>
  async () =>
    value as DockerCommandResult;

const refused = (reason: DockerDispatchRefusalReason): never =>
  refuseDockerDispatch(reason);
let attemptNumber = 0;
const makeAttempt = () => {
  const binding: DockerDispatchBinding = {
    journal: {},
    owner: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    token: "33333333-3333-4333-8333-333333333333",
    reservation: null,
    grantDigest: null,
    attemptId: `44444444-4444-4444-8444-${String(++attemptNumber).padStart(12, "0")}`,
  };
  return { attempt: createDockerDispatchAttempt(binding), binding };
};

test("gate refusal retains known outcome and never invokes transport", async () => {
  let calls = 0;
  const { attempt, binding } = makeAttempt();
  const outcome = await dispatchDockerCommand(
    attempt,
    async () => {
      calls += 1;
      return result;
    },
    "docker",
    ["stop", "fixture"],
    options,
    { ...neverGate, check: async () => refused("SUPERVISOR_CANCELLED") },
    noAuthorityFailure,
  );
  assert.deepEqual(outcome, {
    kind: "KNOWN_NOT_DISPATCHED",
    attemptId: attempt.attemptId,
    reason: "SUPERVISOR_CANCELLED",
    provenance: "TRUSTED_PRE_DISPATCH_GATE",
  });
  assert.equal(consumeDockerNonDispatch(outcome, attempt, binding), true);
  assert.equal(consumeDockerNonDispatch(outcome, attempt, binding), false);
  assert.equal(calls, 0);
  const forged = {
    kind: "KNOWN_NOT_DISPATCHED",
    reason: "SUPERVISOR_CANCELLED",
    provenance: "TRUSTED_PRE_DISPATCH_GATE",
  };
  assert.equal(consumeDockerNonDispatch(forged, attempt, binding), false);
});

test("only registered error identity is known; a plain lookalike is uncertain", async () => {
  for (const error of [
    Object.assign(new Error("SUPERVISOR_TIMEOUT"), {
      name: "SUPERVISOR_TIMEOUT",
      reason: "SUPERVISOR_TIMEOUT",
      provenance: "TRUSTED_PRE_DISPATCH_GATE",
    }),
    { name: "Error", message: "SUPERVISOR_TIMEOUT" },
  ]) {
    const outcome = await dispatchDockerCommand(
      makeAttempt().attempt,
      async () => result,
      "docker",
      [],
      options,
      {
        ...neverGate,
        check: async () => {
          throw error;
        },
      },
      noAuthorityFailure,
    );
    assert.deepEqual(outcome, {
      kind: "UNCERTAIN",
      provenance: "GATE_EXCEPTION",
    });
  }
});

test("authority expiry after gate checks is an authentic pre-dispatch refusal", async () => {
  let calls = 0;
  const outcome = await dispatchDockerCommand(
    makeAttempt().attempt,
    async () => {
      calls += 1;
      return result;
    },
    "docker",
    [],
    options,
    neverGate,
    () => refused("AUTHORITY_EXPIRED_BEFORE_DISPATCH"),
  );
  assert.equal(outcome.kind, "KNOWN_NOT_DISPATCHED");
  if (outcome.kind !== "KNOWN_NOT_DISPATCHED")
    throw new Error("missing known refusal");
  assert.match(outcome.attemptId, /^[0-9a-f-]{36}$/);
  assert.equal(outcome.reason, "AUTHORITY_EXPIRED_BEFORE_DISPATCH");
  assert.equal(outcome.provenance, "TRUSTED_PRE_DISPATCH_GATE");
  assert.equal(calls, 0);
});

test("gate exceptions are uncertain and do not suppress the authority check ordering", async () => {
  const order: string[] = [];
  const outcome = await dispatchDockerCommand(
    makeAttempt().attempt,
    async () => result,
    "docker",
    [],
    options,
    {
      check: async () => {
        order.push("check");
        throw new Error("gate failed");
      },
      assertTime: () => order.push("time"),
    },
    () => order.push("authority"),
  );
  assert.deepEqual(outcome, {
    kind: "UNCERTAIN",
    provenance: "GATE_EXCEPTION",
  });
  assert.deepEqual(order, ["check"]);
});
test("valid process result is classified as dispatched", async () => {
  const outcome = await dispatchDockerCommand(
    makeAttempt().attempt,
    transportReturning(result),
    "docker",
    [],
    options,
    neverGate,
    noAuthorityFailure,
  );
  assert.deepEqual(outcome, { kind: "DISPATCHED_WITH_RESULT", result });
});

test("delegate throws, even with a branded refusal, are uncertain", async () => {
  const outcome = await dispatchDockerCommand(
    makeAttempt().attempt,
    async () => refused("SUPERVISOR_DISCONNECTED"),
    "docker",
    [],
    options,
    neverGate,
    noAuthorityFailure,
  );
  assert.deepEqual(outcome, {
    kind: "UNCERTAIN",
    provenance: "TRANSPORT_EXCEPTION",
  });
});

test("forged outcome metadata and malformed process fields are rejected", async () => {
  const invalidResults: unknown[] = [
    { ...result, kind: "DISPATCHED_WITH_RESULT" },
    { ...result, provenance: "TRUSTED_PRE_DISPATCH_GATE" },
    { ...result, code: 1.5 },
    { ...result, code: Number.MAX_SAFE_INTEGER + 1 },
    { ...result, timedOut: 0 },
    { ...result, spawnError: false },
    { ...result, extra: "unexpected" },
  ];
  for (const invalid of invalidResults) {
    const outcome = await dispatchDockerCommand(
      makeAttempt().attempt,
      transportReturning(invalid),
      "docker",
      [],
      options,
      neverGate,
      noAuthorityFailure,
    );
    assert.deepEqual(outcome, {
      kind: "UNCERTAIN",
      provenance: "INVALID_TRANSPORT_RESULT",
    });
  }
});

test("valid but uncertain process outcomes retain the exact actual result", async () => {
  const uncertainResults: DockerCommandResult[] = [
    { ...result, timedOut: true },
    { ...result, signal: "SIGTERM" },
    { ...result, code: null },
    { ...result, spawnError: "spawn failed" },
  ];
  for (const actual of uncertainResults) {
    const outcome: DockerCommandOutcome = await dispatchDockerCommand(
      makeAttempt().attempt,
      transportReturning(actual),
      "docker",
      [],
      options,
      neverGate,
      noAuthorityFailure,
    );
    assert.deepEqual(outcome, {
      kind: "UNCERTAIN",
      provenance: "PROCESS_UNCERTAIN",
      result: actual,
    });
  }
});
