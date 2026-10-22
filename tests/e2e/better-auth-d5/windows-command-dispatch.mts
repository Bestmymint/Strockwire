import type {
  DockerCommandResult,
  DockerCommandTransport,
} from "./windows-resources.mts";

export type DockerDispatchRefusalReason =
  | "SUPERVISOR_CANCELLED"
  | "SUPERVISOR_DISCONNECTED"
  | "SUPERVISOR_TIMEOUT"
  | "SUPERVISOR_GRANT_REFUSED"
  | "AUTHORITY_EXPIRED_BEFORE_DISPATCH";

const refusalReasons: ReadonlySet<string> = new Set([
  "SUPERVISOR_CANCELLED",
  "SUPERVISOR_DISCONNECTED",
  "SUPERVISOR_TIMEOUT",
  "SUPERVISOR_GRANT_REFUSED",
  "AUTHORITY_EXPIRED_BEFORE_DISPATCH",
]);
const refusalErrors = new WeakMap<Error, DockerDispatchRefusalReason>();

export const isDockerDispatchRefusalReason = (
  value: unknown,
): value is DockerDispatchRefusalReason =>
  typeof value === "string" && refusalReasons.has(value);

export const refuseDockerDispatch = (
  reason: DockerDispatchRefusalReason,
): never => {
  if (!isDockerDispatchRefusalReason(reason)) {
    throw new TypeError("Invalid Docker dispatch refusal reason");
  }
  const error = new Error(reason);
  refusalErrors.set(error, reason);
  throw error;
};

export type DockerDispatchGate = Readonly<{
  check(executable: string, args: readonly string[]): Promise<void>;
  assertTime(): void;
}>;

export type DockerDispatchBinding = Readonly<{
  journal: object;
  owner: string;
  runId: string;
  token: string;
  reservation: number | null;
  grantDigest: string | null;
  attemptId: string;
}>;

export type DockerDispatchAttempt = Readonly<{ attemptId: string }>;

type AttemptState = {
  scope: DockerDispatchBinding;
  state: "READY" | "CLAIMED" | "REFUSED" | "CONSUMED";
};
const attempts = new WeakMap<object, AttemptState>();
const refusalProofs = new WeakMap<object, DockerDispatchAttempt>();

export const createDockerDispatchAttempt = (
  binding: DockerDispatchBinding,
): DockerDispatchAttempt => {
  const frozenBinding = Object.freeze({ ...binding });
  const attempt = Object.freeze({ attemptId: binding.attemptId });
  attempts.set(attempt, { scope: frozenBinding, state: "READY" });
  return attempt;
};

export type DockerCommandOutcome =
  | Readonly<{
      kind: "KNOWN_NOT_DISPATCHED";
      attemptId: string;
      reason: DockerDispatchRefusalReason;
      provenance: "TRUSTED_PRE_DISPATCH_GATE";
    }>
  | Readonly<{
      kind: "DISPATCHED_WITH_RESULT";
      result: DockerCommandResult;
    }>
  | Readonly<{
      kind: "UNCERTAIN";
      provenance:
        | "GATE_EXCEPTION"
        | "TRANSPORT_EXCEPTION"
        | "INVALID_TRANSPORT_RESULT"
        | "PROCESS_UNCERTAIN"
        | "INVALID_DISPATCH_ATTEMPT";
      result?: DockerCommandResult;
    }>;

export type KnownDockerCommandOutcome = Extract<
  DockerCommandOutcome,
  { kind: "KNOWN_NOT_DISPATCHED" }
>;

export const consumeDockerNonDispatch = (
  value: unknown,
  expectedAttempt: DockerDispatchAttempt,
  expectedBinding: DockerDispatchBinding,
): value is KnownDockerCommandOutcome => {
  if (!value || typeof value !== "object") return false;
  const state = attempts.get(expectedAttempt as object);
  const proofAttempt = refusalProofs.get(value);
  if (!state || proofAttempt !== expectedAttempt || state.state !== "REFUSED")
    return false;
  const actual = state.scope;
  if (
    actual.journal !== expectedBinding.journal ||
    actual.owner !== expectedBinding.owner ||
    actual.runId !== expectedBinding.runId ||
    actual.token !== expectedBinding.token ||
    actual.reservation !== expectedBinding.reservation ||
    actual.grantDigest !== expectedBinding.grantDigest ||
    actual.attemptId !== expectedBinding.attemptId ||
    (value as KnownDockerCommandOutcome).attemptId !== actual.attemptId
  )
    return false;
  state.state = "CONSUMED";
  refusalProofs.delete(value);
  return true;
};

const createKnownOutcome = (
  attempt: DockerDispatchAttempt,
  reason: DockerDispatchRefusalReason,
): KnownDockerCommandOutcome => {
  const outcome: KnownDockerCommandOutcome = Object.freeze({
    kind: "KNOWN_NOT_DISPATCHED",
    attemptId: attempt.attemptId,
    reason,
    provenance: "TRUSTED_PRE_DISPATCH_GATE",
  });
  refusalProofs.set(outcome, attempt);
  const state = attempts.get(attempt as object);
  if (state) state.state = "REFUSED";
  return outcome;
};

const isDockerCommandResult = (
  value: unknown,
): value is DockerCommandResult => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        key !== "stdout" &&
        key !== "stderr" &&
        key !== "code" &&
        key !== "signal" &&
        key !== "timedOut" &&
        key !== "spawnError",
    ) ||
    !Object.hasOwn(value, "stdout") ||
    !Object.hasOwn(value, "stderr") ||
    !Object.hasOwn(value, "code") ||
    !Object.hasOwn(value, "signal") ||
    !Object.hasOwn(value, "timedOut")
  ) {
    return false;
  }

  const result = value as Record<string, unknown>;
  return (
    typeof result.stdout === "string" &&
    typeof result.stderr === "string" &&
    (result.code === null ||
      (typeof result.code === "number" && Number.isSafeInteger(result.code))) &&
    (result.signal === null || typeof result.signal === "string") &&
    typeof result.timedOut === "boolean" &&
    (!Object.hasOwn(value, "spawnError") ||
      result.spawnError === null ||
      typeof result.spawnError === "string")
  );
};

export const dispatchDockerCommand = async (
  attempt: DockerDispatchAttempt,
  transport: DockerCommandTransport,
  executable: string,
  args: readonly string[],
  options: Parameters<DockerCommandTransport>[2],
  gate: DockerDispatchGate | undefined,
  assertAuthority: () => void,
): Promise<DockerCommandOutcome> => {
  const state = attempts.get(attempt as object);
  if (!state || state.state !== "READY")
    return { kind: "UNCERTAIN", provenance: "INVALID_DISPATCH_ATTEMPT" };
  state.state = "CLAIMED";
  try {
    if (gate) {
      await gate.check(executable, args);
      gate.assertTime();
    }
    assertAuthority();
  } catch (error) {
    const reason =
      error instanceof Error ? refusalErrors.get(error) : undefined;
    return reason
      ? createKnownOutcome(attempt, reason)
      : { kind: "UNCERTAIN", provenance: "GATE_EXCEPTION" };
  }

  let rawResult: unknown;
  try {
    rawResult = await transport(executable, args, options);
  } catch {
    return { kind: "UNCERTAIN", provenance: "TRANSPORT_EXCEPTION" };
  }

  try {
    if (!isDockerCommandResult(rawResult)) {
      return { kind: "UNCERTAIN", provenance: "INVALID_TRANSPORT_RESULT" };
    }
    const processResult = rawResult as DockerCommandResult;
    if (
      processResult.timedOut ||
      processResult.signal !== null ||
      processResult.code === null ||
      (processResult.spawnError !== undefined &&
        processResult.spawnError !== null)
    ) {
      return {
        kind: "UNCERTAIN",
        provenance: "PROCESS_UNCERTAIN",
        result: processResult,
      };
    }
    return { kind: "DISPATCHED_WITH_RESULT", result: processResult };
  } catch {
    return { kind: "UNCERTAIN", provenance: "INVALID_TRANSPORT_RESULT" };
  }
};
