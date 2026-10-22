import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename } from "node:fs/promises";
import { dirname, resolve, win32 } from "node:path";
import { parseWindowsResourceRequest } from "./windows-resource-invocation.mts";
import type { OperatorGrant } from "./windows-resources.mts";
import type { JournalCheckpoint } from "./windows-lease-journal.mts";
import { refuseDockerDispatch } from "./windows-command-dispatch.mts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const PLAN_KEYS =
  "approvalDirectory,candidateRoot,channelDirectory,checkpoint,contract,evidenceDirectory,migrationSha256,mode,requestBytes,requestSha256,sessionId,sourceSha256,timeoutMs";
const COMMAND_KEYS = "contract,grant,operation,sequence,sessionId";
const AUTHORITY_KEYS = "contract,grantSha256,messageSha256,sequence,sessionId";
const MAX_PLAN = 2 * 1024 * 1024;
const MAX_COMMAND = 65536;
const MAX_AUTHORITY = 4096;
const MAX_CONTROL = 8192;
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
type Fields = Record<string, unknown>;
function fail(code: string): never {
  if (code === "SUPERVISOR_CANCELLED" || code === "SUPERVISOR_DISCONNECTED")
    refuseDockerDispatch(code);
  throw new Error(code);
}
function record(value: unknown, code: string): Fields {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Fields;
}
function exact(value: Fields, keys: string, code: string): void {
  if (Object.keys(value).sort().join(",") !== keys) fail(code);
}
function parseJson(bytes: string, code: string): unknown {
  try {
    return JSON.parse(bytes) as unknown;
  } catch {
    return fail(code);
  }
}
export function canonicalSupervisorValue(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("SUPERVISOR_VALUE_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map(canonicalSupervisorValue).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Fields).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalSupervisorValue(item)}`).join(",")}}`;
  }
  return fail("SUPERVISOR_VALUE_INVALID");
}
export type SupervisorPlan = Readonly<{
  contract: "D5-WINDOWS-SUPERVISOR-v1";
  sessionId: string;
  mode: "acquire-bootstrap" | "cleanup-only";
  candidateRoot: string;
  requestBytes: string;
  requestSha256: string;
  sourceSha256: string;
  migrationSha256: string;
  channelDirectory: string;
  approvalDirectory: string;
  evidenceDirectory: string;
  timeoutMs: number;
  checkpoint: JournalCheckpoint | null;
}>;
export function parseSupervisorPlan(
  bytes: string,
  reviewedSha256: string,
): SupervisorPlan {
  if (
    typeof bytes !== "string" ||
    Buffer.byteLength(bytes, "utf8") > MAX_PLAN ||
    !HASH.test(reviewedSha256) ||
    hash(bytes) !== reviewedSha256
  )
    fail("SUPERVISOR_PLAN_PIN_INVALID");
  const value = record(
    parseJson(bytes, "SUPERVISOR_PLAN_INVALID"),
    "SUPERVISOR_PLAN_INVALID",
  );
  exact(value, PLAN_KEYS, "SUPERVISOR_PLAN_INVALID");
  if (
    value.contract !== "D5-WINDOWS-SUPERVISOR-v1" ||
    typeof value.sessionId !== "string" ||
    !UUID.test(value.sessionId) ||
    (value.mode !== "acquire-bootstrap" && value.mode !== "cleanup-only") ||
    typeof value.candidateRoot !== "string" ||
    typeof value.requestBytes !== "string" ||
    Buffer.byteLength(value.requestBytes, "utf8") > 1024 * 1024 ||
    typeof value.requestSha256 !== "string" ||
    !HASH.test(value.requestSha256) ||
    typeof value.sourceSha256 !== "string" ||
    !HASH.test(value.sourceSha256) ||
    typeof value.migrationSha256 !== "string" ||
    !HASH.test(value.migrationSha256) ||
    typeof value.channelDirectory !== "string" ||
    typeof value.approvalDirectory !== "string" ||
    typeof value.evidenceDirectory !== "string" ||
    !Number.isInteger(value.timeoutMs) ||
    (value.timeoutMs as number) < 1000 ||
    (value.timeoutMs as number) > 60000
  )
    fail("SUPERVISOR_PLAN_INVALID");
  const request = parseWindowsResourceRequest(
    value.requestBytes,
    value.requestSha256,
  );
  if (
    request.operation !== "acquire" ||
    typeof request.leaseId !== "string" ||
    !UUID.test(request.leaseId) ||
    (value.mode === "acquire-bootstrap" && value.checkpoint !== null) ||
    (value.mode === "cleanup-only" &&
      (!validCheckpoint(value.checkpoint) ||
        value.checkpoint.owner !== request.leaseId))
  )
    fail("SUPERVISOR_PLAN_INVALID");
  return value as unknown as SupervisorPlan;
}
function validCheckpoint(value: unknown): value is JournalCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Fields;
  return (
    Object.keys(fields).sort().join(",") ===
      "journalSha256,owner,runId,token" &&
    typeof fields.owner === "string" &&
    UUID.test(fields.owner) &&
    typeof fields.runId === "string" &&
    UUID.test(fields.runId) &&
    typeof fields.token === "string" &&
    UUID.test(fields.token) &&
    typeof fields.journalSha256 === "string" &&
    HASH.test(fields.journalSha256)
  );
}
export type SupervisorMessage = Readonly<{
  contract: "D5-WINDOWS-COMMAND-v1";
  sessionId: string;
  sequence: number;
  operation: "acquire" | "bootstrap" | "cleanup";
  grant: OperatorGrant;
}>;
export type ApprovedSupervisorMessage = Readonly<{
  message: SupervisorMessage;
  grantSha256: string;
}>;
export function parseSupervisorMessage(
  bytes: string,
  authorityBytes: string,
  sessionId: string,
  expectedSequence: number,
): ApprovedSupervisorMessage {
  if (
    Buffer.byteLength(bytes, "utf8") > MAX_COMMAND ||
    Buffer.byteLength(authorityBytes, "utf8") > MAX_AUTHORITY ||
    !UUID.test(sessionId) ||
    !Number.isSafeInteger(expectedSequence) ||
    expectedSequence < 1
  )
    fail("SUPERVISOR_COMMAND_INVALID");
  const message = record(
    parseJson(bytes, "SUPERVISOR_COMMAND_INVALID"),
    "SUPERVISOR_COMMAND_INVALID",
  );
  exact(message, COMMAND_KEYS, "SUPERVISOR_COMMAND_INVALID");
  if (
    message.contract !== "D5-WINDOWS-COMMAND-v1" ||
    message.sessionId !== sessionId ||
    message.sequence !== expectedSequence ||
    (message.operation !== "acquire" &&
      message.operation !== "bootstrap" &&
      message.operation !== "cleanup")
  )
    fail("SUPERVISOR_COMMAND_INVALID");
  const grant = record(message.grant, "SUPERVISOR_GRANT_INVALID");
  exact(grant, "contract,digestInput", "SUPERVISOR_GRANT_INVALID");
  if (
    (message.operation === "cleanup" && grant.contract !== "G3-D") ||
    (message.operation !== "cleanup" && grant.contract !== "G3-C")
  )
    fail("SUPERVISOR_GRANT_INVALID");
  const digestInput = record(grant.digestInput, "SUPERVISOR_GRANT_INVALID");
  if (digestInput.operation !== message.operation)
    fail("SUPERVISOR_GRANT_INVALID");
  const grantSha256 = hash(canonicalSupervisorValue(grant.digestInput));
  const authority = record(
    parseJson(authorityBytes, "SUPERVISOR_AUTHORITY_INVALID"),
    "SUPERVISOR_AUTHORITY_INVALID",
  );
  exact(authority, AUTHORITY_KEYS, "SUPERVISOR_AUTHORITY_INVALID");
  if (
    authority.contract !== "D5-WINDOWS-AUTHORITY-v1" ||
    authority.sessionId !== sessionId ||
    authority.sequence !== expectedSequence ||
    authority.messageSha256 !== hash(bytes) ||
    authority.grantSha256 !== grantSha256
  )
    fail("SUPERVISOR_AUTHORITY_INVALID");
  return { message: message as unknown as SupervisorMessage, grantSha256 };
}
export type SupervisorState =
  | "WAITING_APPROVAL"
  | "ACQUIRING"
  | "ACQUIRED"
  | "WAITING_BOOTSTRAP"
  | "BOOTSTRAPPING"
  | "RECOVERING"
  | "CLEANING"
  | "RELEASED"
  | "INCOMPLETE"
  | "FAILED";
export type SupervisorIdentity = Readonly<{
  owner: string;
  runId: string;
  token: string;
  containerName: string;
  containerId: string | null;
  networkName: string;
  networkId: string | null;
  volumeName: string;
  volumeBirth: string | null;
}>;
export type SupervisorStatus = Readonly<{
  contract: "D5-WINDOWS-STATUS-v1";
  sessionId: string;
  leaseId: string;
  state: SupervisorState;
  reason: string | null;
  identity: SupervisorIdentity | null;
  failureCount: number;
  cleanup: "NOT_RUN" | "INCOMPLETE" | "COMPLETE";
  checkpointSha256: string | null;
}>;
export interface SupervisorChannel {
  assertLive(): Promise<void>;
  next(sequence: number): Promise<ApprovedSupervisorMessage | null>;
  status(value: SupervisorStatus): Promise<void>;
  checkpoint(value: JournalCheckpoint): Promise<void>;
  close(): Promise<void>;
}
function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function canonicalPath(value: string): string {
  if (!/^[A-Za-z]:\\/.test(value) || value.includes("/") || hasControl(value))
    fail("SUPERVISOR_PATH_INVALID");
  const normalized = win32.normalize(value);
  if (normalized !== value || win32.resolve(value) !== value)
    fail("SUPERVISOR_PATH_INVALID");
  const components = win32
    .relative(win32.parse(normalized).root, normalized)
    .split("\\");
  if (
    components.some(
      (part) =>
        !part ||
        /[<>:"|?*]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    fail("SUPERVISOR_PATH_INVALID");
  return normalized;
}
function overlaps(a: string, b: string): boolean {
  const left = win32.resolve(a).toLowerCase(),
    right = win32.resolve(b).toLowerCase();
  return (
    left === right ||
    left.startsWith(`${right}\\`) ||
    right.startsWith(`${left}\\`)
  );
}
async function assertDirectory(path: string): Promise<void> {
  const normalized = canonicalPath(path);
  const root = win32.parse(normalized).root;
  const rootState = await lstat(root);
  if (!rootState.isDirectory() || rootState.isSymbolicLink())
    fail("SUPERVISOR_PATH_INVALID");
  let current = root;
  const components = win32
    .relative(root, normalized)
    .split("\\")
    .filter((part) => part.length > 0);
  for (const component of components) {
    current = win32.join(current, component);
    const state = await lstat(current);
    if (!state.isDirectory() || state.isSymbolicLink())
      fail("SUPERVISOR_PATH_INVALID");
  }
}
export async function readSupervisorFile(
  path: string,
  maxBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    fail("SUPERVISOR_INPUT_INVALID");
  const normalized = canonicalPath(path);
  const root = win32.parse(normalized).root;
  const rootState = await lstat(root);
  if (!rootState.isDirectory() || rootState.isSymbolicLink())
    fail("SUPERVISOR_INPUT_INVALID");
  let current = root;
  const components = win32
    .relative(root, win32.dirname(normalized))
    .split("\\")
    .filter((part) => part.length > 0);
  for (const component of components) {
    current = win32.join(current, component);
    const ancestor = await lstat(current);
    if (!ancestor.isDirectory() || ancestor.isSymbolicLink())
      fail("SUPERVISOR_INPUT_INVALID");
  }
  const before = await lstat(normalized);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes)
    fail("SUPERVISOR_INPUT_INVALID");
  const file = await open(normalized, "r");
  try {
    const opened = await file.stat();
    if (
      !opened.isFile() ||
      opened.size > maxBytes ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      fail("SUPERVISOR_INPUT_INVALID");
    const bytes = await file.readFile();
    const after = await file.stat();
    const currentState = await lstat(normalized);
    if (
      bytes.byteLength > maxBytes ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      !currentState.isFile() ||
      currentState.isSymbolicLink() ||
      currentState.dev !== after.dev ||
      currentState.ino !== after.ino ||
      currentState.size !== after.size ||
      currentState.mtimeMs !== after.mtimeMs ||
      currentState.ctimeMs !== after.ctimeMs
    )
      fail("SUPERVISOR_INPUT_INVALID");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return fail("SUPERVISOR_INPUT_INVALID");
    }
  } finally {
    await file.close();
  }
}
async function bounded(path: string, limit: number): Promise<string | null> {
  try {
    return await readSupervisorFile(path, limit);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}
export async function openSupervisorChannel(
  plan: SupervisorPlan,
  trustedRoot: string,
): Promise<SupervisorChannel> {
  const candidate = canonicalPath(plan.candidateRoot),
    trusted = canonicalPath(trustedRoot);
  const channel = canonicalPath(plan.channelDirectory),
    approval = canonicalPath(plan.approvalDirectory),
    evidence = canonicalPath(plan.evidenceDirectory);
  const request = parseWindowsResourceRequest(
    plan.requestBytes,
    plan.requestSha256,
  );
  const journal = canonicalPath(request.journalDirectory);
  if (
    overlaps(candidate, trusted) ||
    [channel, approval, evidence, journal].some(
      (path) => overlaps(path, candidate) || overlaps(path, trusted),
    ) ||
    overlaps(channel, approval) ||
    overlaps(channel, evidence) ||
    overlaps(channel, journal) ||
    overlaps(approval, evidence) ||
    overlaps(approval, journal) ||
    overlaps(evidence, journal)
  )
    fail("SUPERVISOR_PATH_OVERLAP");
  for (const path of [
    candidate,
    trusted,
    channel,
    approval,
    journal,
    dirname(evidence),
  ])
    await assertDirectory(path);
  await mkdir(evidence);
  await assertDirectory(evidence);
  const context = {
    contract: "D5-WINDOWS-SUPERVISOR-CONTEXT-v1",
    sessionId: plan.sessionId,
    mode: plan.mode,
    leaseId: request.leaseId,
    journalDirectory: request.journalDirectory,
    sourceSha256: plan.sourceSha256,
    migrationSha256: plan.migrationSha256,
  };
  const contextFile = await open(
    resolve(evidence, "context.json"),
    "wx",
    0o600,
  );
  try {
    await contextFile.writeFile(
      `${canonicalSupervisorValue(context)}\n`,
      "utf8",
    );
    await contextFile.sync();
  } finally {
    await contextFile.close();
  }
  const evidencePath = (name: string) => resolve(evidence, name);
  const inputPath = (base: string, name: string) => resolve(base, name);
  let heartbeatCounter = -1,
    heartbeatTime = -1,
    lastCommand: string | null = null,
    lastApproved: ApprovedSupervisorMessage | null = null;
  let lastCheckpoint = false,
    closed = false;
  const append = async (value: unknown) => {
    const file = await open(evidencePath("events.jsonl"), "a", 0o600);
    try {
      await file.writeFile(`${canonicalSupervisorValue(value)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
  };
  const channelValue: SupervisorChannel = {
    async assertLive() {
      if (closed) fail("SUPERVISOR_CHANNEL_CLOSED");
      const bytes = await bounded(
        inputPath(channel, "heartbeat.json"),
        MAX_CONTROL,
      );
      if (bytes === null) fail("SUPERVISOR_DISCONNECTED");
      const heartbeat = record(
        parseJson(bytes, "SUPERVISOR_DISCONNECTED"),
        "SUPERVISOR_DISCONNECTED",
      );
      exact(
        heartbeat,
        "contract,counter,sessionId,time",
        "SUPERVISOR_DISCONNECTED",
      );
      const now = Date.now();
      if (
        heartbeat.contract !== "D5-WINDOWS-HEARTBEAT-v1" ||
        heartbeat.sessionId !== plan.sessionId ||
        !Number.isSafeInteger(heartbeat.counter) ||
        (heartbeat.counter as number) < 0 ||
        (heartbeat.counter as number) < heartbeatCounter ||
        !Number.isSafeInteger(heartbeat.time) ||
        (heartbeat.time as number) > now + 1000 ||
        now - (heartbeat.time as number) > 3000 ||
        (heartbeat.counter === heartbeatCounter &&
          heartbeat.time !== heartbeatTime)
      )
        fail("SUPERVISOR_DISCONNECTED");
      heartbeatCounter = heartbeat.counter as number;
      heartbeatTime = heartbeat.time as number;
      const cancelBytes = await bounded(
        inputPath(channel, "cancel.json"),
        MAX_CONTROL,
      );
      if (cancelBytes !== null) {
        const cancel = record(
          parseJson(cancelBytes, "SUPERVISOR_CANCELLED"),
          "SUPERVISOR_CANCELLED",
        );
        exact(cancel, "contract,sessionId", "SUPERVISOR_CANCELLED");
        if (
          cancel.contract === "D5-WINDOWS-CANCEL-v1" &&
          cancel.sessionId === plan.sessionId
        )
          fail("SUPERVISOR_CANCELLED");
        fail("SUPERVISOR_CANCELLED");
      }
    },
    async next(sequence) {
      await this.assertLive();
      const bytes = await bounded(
        inputPath(channel, "command.json"),
        MAX_COMMAND,
      );
      if (bytes === null) return null;
      if (bytes === lastCommand) return null;
      const authority = await bounded(
        inputPath(approval, "authority.json"),
        MAX_AUTHORITY,
      );
      if (authority === null) return null;
      const approved = parseSupervisorMessage(
        bytes,
        authority,
        plan.sessionId,
        sequence,
      );
      if (lastApproved && approved.grantSha256 === lastApproved.grantSha256)
        fail("SUPERVISOR_COMMAND_REPLAY");
      lastCommand = bytes;
      lastApproved = approved;
      return approved;
    },
    async status(value) {
      if (closed) fail("SUPERVISOR_CHANNEL_CLOSED");
      const valueFields = record(value, "SUPERVISOR_STATUS_INVALID");
      exact(
        valueFields,
        "checkpointSha256,cleanup,contract,failureCount,identity,leaseId,reason,sessionId,state",
        "SUPERVISOR_STATUS_INVALID",
      );
      const states = [
        "WAITING_APPROVAL",
        "ACQUIRING",
        "ACQUIRED",
        "WAITING_BOOTSTRAP",
        "BOOTSTRAPPING",
        "RECOVERING",
        "CLEANING",
        "RELEASED",
        "INCOMPLETE",
        "FAILED",
      ];
      const reasonCodes = [
        "SUPERVISOR_TIMEOUT",
        "SUPERVISOR_CANCELLED",
        "SUPERVISOR_DISCONNECTED",
        "SUPERVISOR_GRANT_REFUSED",
        "SUPERVISOR_TRANSITION_REFUSED",
        "SUPERVISOR_REPLAY_REFUSED",
        "SUPERVISOR_ACQUISITION_INCOMPLETE",
        "SUPERVISOR_OPERATION_REFUSED",
        "SUPERVISOR_RELEASE_INCOMPLETE",
      ];
      if (
        valueFields.contract !== "D5-WINDOWS-STATUS-v1" ||
        valueFields.sessionId !== plan.sessionId ||
        typeof valueFields.leaseId !== "string" ||
        !UUID.test(valueFields.leaseId) ||
        !states.includes(String(valueFields.state)) ||
        (valueFields.reason !== null &&
          (typeof valueFields.reason !== "string" ||
            !reasonCodes.includes(valueFields.reason))) ||
        !Number.isSafeInteger(valueFields.failureCount) ||
        (valueFields.failureCount as number) < 0 ||
        !["NOT_RUN", "INCOMPLETE", "COMPLETE"].includes(
          String(valueFields.cleanup),
        ) ||
        (valueFields.checkpointSha256 !== null &&
          (typeof valueFields.checkpointSha256 !== "string" ||
            !HASH.test(valueFields.checkpointSha256)))
      )
        fail("SUPERVISOR_STATUS_INVALID");
      if (valueFields.identity !== null) {
        const identity = record(
          valueFields.identity,
          "SUPERVISOR_STATUS_INVALID",
        );
        exact(
          identity,
          "containerId,containerName,networkId,networkName,owner,runId,token,volumeBirth,volumeName",
          "SUPERVISOR_STATUS_INVALID",
        );
        for (const [key, item] of Object.entries(identity)) {
          if (
            (key === "containerId" ||
              key === "networkId" ||
              key === "volumeBirth") &&
            item === null
          )
            continue;
          if (
            typeof item !== "string" ||
            item.length === 0 ||
            /[\r\n\0]/.test(item)
          )
            fail("SUPERVISOR_STATUS_INVALID");
        }
      }
      const bytes = `${canonicalSupervisorValue(value)}\n`;
      const temporary = evidencePath(`.status-${randomUUID()}.tmp`);
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(bytes, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, evidencePath("status.json"));
      await append({
        contract: "D5-WINDOWS-EVENT-v1",
        type: "STATUS",
        status: value,
      });
    },
    async checkpoint(value) {
      if (closed || lastCheckpoint || !validCheckpoint(value))
        fail("SUPERVISOR_CHECKPOINT_INVALID");
      const file = await open(evidencePath("checkpoint.json"), "wx", 0o600);
      try {
        await file.writeFile(`${canonicalSupervisorValue(value)}\n`, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      lastCheckpoint = true;
      await append({
        contract: "D5-WINDOWS-EVENT-v1",
        type: "CHECKPOINT",
        sha256: hash(canonicalSupervisorValue(value)),
      });
    },
    async close() {
      closed = true;
    },
  };
  await append({
    contract: "D5-WINDOWS-EVENT-v1",
    type: "OPENED",
    sessionId: plan.sessionId,
  });
  return channelValue;
}
