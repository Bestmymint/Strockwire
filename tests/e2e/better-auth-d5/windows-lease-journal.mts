import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  consumeDockerNonDispatch,
  createDockerDispatchAttempt,
  dispatchDockerCommand as dispatchBoundDockerCommand,
  isDockerDispatchRefusalReason,
  type DockerCommandOutcome,
  type DockerDispatchAttempt,
  type DockerDispatchBinding,
  type KnownDockerCommandOutcome,
} from "./windows-command-dispatch.mts";
import type { DockerCommandTransport } from "./windows-resources.mts";

type Fields = Record<string, unknown>;
export type LeaseFailure = Readonly<{
  sequence: number;
  timestamp: number;
  category:
    | "PROCESS"
    | "ACQUISITION"
    | "BOOTSTRAP"
    | "SAFETY"
    | "AUTHORIZATION"
    | "EVIDENCE";
  code: string;
  evidence: Fields;
}>;
export type JournalIdentity = Readonly<{
  owner: string;
  runId: string;
  token: string;
}>;
export type JournalCheckpoint = JournalIdentity &
  Readonly<{ journalSha256: string }>;
type Entry = Fields & {
  seq: number;
  time: number;
  event: string;
  hash: string;
};
type GrantAccount = { maximum: number; expiresAt: number; used: number };
type Reservation = {
  digest: string;
  command: string;
  destructive: boolean;
  finished: boolean;
  uncertain: boolean;
  attemptId?: string;
};
const HASH = /^[a-f0-9]{64}$/;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_BYTES = 16 * 1024 * 1024;
const EMPTY = "0".repeat(64);
export class LeaseJournalError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
function fail(code: string): never {
  throw new LeaseJournalError(code);
}
function object(value: unknown): Fields {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("LEASE_JOURNAL_RECORD_INVALID");
  return value as Fields;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const bytes = JSON.stringify(value);
    if (bytes === undefined) fail("LEASE_JOURNAL_VALUE_INVALID");
    return bytes;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object(value)[key])}`)
    .join(",")}}`;
}
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
type FileState = Awaited<ReturnType<typeof lstat>>;
function sameFile(a: FileState, b: FileState): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

/** One append-only authority ledger per lease/run. A checkpoint is evidence, never permission. */
export class LeaseJournal {
  private readonly directory: string;
  private readonly identity: JournalIdentity;
  private readonly now: () => number;
  private readonly session = randomUUID();
  private sequence = 0;
  private head = EMPTY;
  private wireBytes = 0;
  private fileState: FileState | null = null;
  private closed = false;
  private damaged = false;
  private readonly accounts = new Map<string, GrantAccount>();
  private latestGrant: string | null = null;
  private readonly reservations = new Map<number, Reservation>();
  #dispatchAttempts = new Map<
    number,
    { attempt: DockerDispatchAttempt; scope: DockerDispatchBinding }
  >();
  private readonly retainedFailures: LeaseFailure[] = [];
  private last: Entry | null = null;
  private origin: Fields | null = null;
  private readonly acquisitions = new Map<
    string,
    {
      kind: string;
      name: string;
      identity: string | null;
      attempted: boolean;
      confirmed: boolean;
      responded: boolean;
    }
  >();
  private constructor(
    directory: string,
    identity: JournalIdentity,
    now: () => number,
  ) {
    this.directory = directory;
    this.identity = {
      owner: identity.owner,
      runId: identity.runId,
      token: identity.token,
    };
    this.now = now;
  }
  get poisoned(): boolean {
    return this.damaged;
  }
  get failures(): LeaseFailure[] {
    return structuredClone(this.retainedFailures);
  }
  get failureCount(): number {
    return this.retainedFailures.length;
  }
  get originConfiguration(): Fields {
    return structuredClone(object(this.origin?.configuration));
  }
  get acquisitionState(): Fields[] {
    return [...this.acquisitions.values()].map((value) => ({
      kind: value.kind,
      name: value.name,
      identity: value.identity,
      attempted: value.attempted,
      confirmed: value.confirmed,
    }));
  }
  get unresolvedDestructive(): boolean {
    return [...this.reservations.values()].some(
      (value) => value.destructive && (!value.finished || value.uncertain),
    );
  }
  get interruptedReservations(): {
    sequence: number;
    command: string;
    digest: string;
  }[] {
    return [...this.reservations]
      .filter(
        ([sequence, value]) =>
          !value.finished &&
          !this.retainedFailures.some(
            (failure) =>
              failure.category === "PROCESS" &&
              failure.evidence.reservation === sequence,
          ),
      )
      .map(([sequence, value]) => ({
        sequence,
        command: value.command,
        digest: value.digest,
      }));
  }
  get recoveredSnapshot(): Fields {
    if (this.last?.event !== "SUPERVISOR_RELEASED")
      fail("LEASE_CHECKPOINT_REQUIRED");
    return structuredClone(object(this.last.snapshot));
  }
  private static async lock(directory: string): Promise<void> {
    const file = await open(join(directory, "supervisor.lock"), "wx");
    try {
      await file.writeFile(`${process.pid}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
  }
  static async create(
    root: string,
    identity: JournalIdentity,
    now: () => number,
  ): Promise<LeaseJournal> {
    if (Object.values(identity).some((value) => !UUID.test(value)))
      fail("LEASE_JOURNAL_IDENTITY_INVALID");
    await mkdir(root, { recursive: true });
    const directory = join(root, identity.owner);
    await mkdir(directory);
    await LeaseJournal.lock(directory);
    const journal = new LeaseJournal(directory, identity, now);
    await journal.event("JOURNAL_CREATED");
    return journal;
  }
  static async recover(
    root: string,
    expected: JournalCheckpoint,
    now: () => number,
  ): Promise<LeaseJournal> {
    if (
      !HASH.test(expected.journalSha256) ||
      [expected.owner, expected.runId, expected.token].some(
        (value) => !UUID.test(value),
      )
    )
      fail("LEASE_CHECKPOINT_INVALID");
    const directory = join(root, expected.owner);
    const path = join(directory, "journal.jsonl");
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES)
      fail("LEASE_JOURNAL_FILE_INVALID");
    const bytes = await readFile(path);
    const journal = new LeaseJournal(directory, expected, now);
    if (bytes.length !== before.size || !bytes.length || bytes.at(-1) !== 10)
      fail("LEASE_JOURNAL_INTERRUPTED_APPEND");
    for (const line of bytes.toString("utf8").trimEnd().split("\n")) {
      if (Buffer.byteLength(line) > 65536)
        fail("LEASE_JOURNAL_RECORD_TOO_LARGE");
      const parsed: unknown = JSON.parse(line);
      journal.accept(object(parsed));
    }
    if (
      journal.head !== expected.journalSha256 ||
      journal.last?.event !== "SUPERVISOR_RELEASED"
    )
      fail("LEASE_CHECKPOINT_STALE_OR_UNRECONCILED");
    journal.wireBytes = bytes.length;
    journal.fileState = before;
    // An unreleased/stale supervisor lock is never removed or taken over automatically.
    await LeaseJournal.lock(directory);
    const after = await lstat(path);
    if (!sameFile(before, after)) {
      await unlink(join(directory, "supervisor.lock"));
      fail("LEASE_JOURNAL_CHANGED_DURING_RECOVERY");
    }
    return journal;
  }
  private accept(value: Fields): void {
    const { hash, ...body } = value;
    if (
      value.version !== 2 ||
      value.owner !== this.identity.owner ||
      value.runId !== this.identity.runId ||
      value.token !== this.identity.token ||
      value.seq !== this.sequence + 1 ||
      value.previousSha256 !== this.head ||
      !Number.isSafeInteger(value.time) ||
      (value.time as number) < 0 ||
      typeof value.event !== "string" ||
      !/^[A-Z_]+$/.test(value.event) ||
      typeof value.session !== "string" ||
      !UUID.test(value.session) ||
      typeof hash !== "string" ||
      !HASH.test(hash) ||
      digest(canonical(body)) !== hash
    )
      fail("LEASE_JOURNAL_CHAIN_INVALID");
    const entry = value as Entry;
    if (this.sequence === 0 && entry.event !== "JOURNAL_CREATED")
      fail("LEASE_JOURNAL_HEADER_INVALID");
    if (entry.event === "LEASE") {
      if (this.origin) fail("LEASE_ORIGIN_DUPLICATED");
      this.origin = entry;
    } else if (entry.event === "CREATE_INTENT") {
      if (
        typeof entry.kind !== "string" ||
        !["container", "network", "volume"].includes(entry.kind) ||
        typeof entry.name !== "string" ||
        this.acquisitions.has(entry.kind)
      )
        fail("LEASE_ACQUISITION_HISTORY_INVALID");
      this.acquisitions.set(entry.kind, {
        kind: entry.kind,
        name: entry.name,
        identity: null,
        attempted: true,
        confirmed: false,
        responded: false,
      });
    } else if (
      entry.event === "CREATE_RESPONSE" ||
      entry.event === "CREATE_CONFIRMED"
    ) {
      const acquisition =
        typeof entry.kind === "string"
          ? this.acquisitions.get(entry.kind)
          : undefined;
      if (!acquisition || acquisition.name !== entry.name)
        fail("LEASE_ACQUISITION_HISTORY_INVALID");
      if (entry.event === "CREATE_RESPONSE") {
        if (
          acquisition.responded ||
          (entry.kind === "volume"
            ? entry.identity !== null
            : typeof entry.identity !== "string" || !HASH.test(entry.identity))
        )
          fail("LEASE_ACQUISITION_HISTORY_INVALID");
        acquisition.responded = true;
        acquisition.identity = entry.identity as string | null;
      } else {
        if (
          !acquisition.responded ||
          acquisition.confirmed ||
          typeof entry.identity !== "string" ||
          !entry.identity ||
          (entry.kind !== "volume" && acquisition.identity !== entry.identity)
        )
          fail("LEASE_ACQUISITION_HISTORY_INVALID");
        acquisition.confirmed = true;
        acquisition.identity = entry.identity;
      }
    }
    if (entry.event === "GRANT_BOUND") {
      if (
        typeof entry.grantDigest !== "string" ||
        !HASH.test(entry.grantDigest) ||
        this.accounts.has(entry.grantDigest) ||
        !Number.isSafeInteger(entry.maximum) ||
        (entry.maximum as number) < 1 ||
        (entry.maximum as number) > 1000 ||
        !Number.isSafeInteger(entry.expiresAt) ||
        entry.supersedes !== this.latestGrant
      )
        fail("LEASE_GRANT_HISTORY_INVALID");
      this.accounts.set(entry.grantDigest, {
        maximum: entry.maximum as number,
        expiresAt: entry.expiresAt as number,
        used: 0,
      });
      this.latestGrant = entry.grantDigest;
    } else if (entry.event === "COMMAND_RESERVED") {
      const account =
        typeof entry.grantDigest === "string"
          ? this.accounts.get(entry.grantDigest)
          : undefined;
      if (
        !account ||
        entry.grantDigest !== this.latestGrant ||
        entry.ordinal !== account.used + 1 ||
        account.used >= account.maximum ||
        typeof entry.command !== "string" ||
        typeof entry.destructive !== "boolean" ||
        (entry.attemptId !== undefined &&
          (typeof entry.attemptId !== "string" || !UUID.test(entry.attemptId)))
      )
        fail("LEASE_RESERVATION_HISTORY_INVALID");
      account.used++;
      this.reservations.set(entry.seq, {
        digest: entry.grantDigest as string,
        command: entry.command,
        destructive: entry.destructive,
        finished: false,
        uncertain: false,
        ...(typeof entry.attemptId === "string"
          ? { attemptId: entry.attemptId }
          : {}),
      });
    } else if (
      entry.event === "COMMAND_RESULT" ||
      entry.event === "COMMAND_NOT_DISPATCHED"
    ) {
      const reservation =
        typeof entry.reservation === "number"
          ? this.reservations.get(entry.reservation)
          : undefined;
      if (
        !reservation ||
        reservation.finished ||
        typeof entry.uncertain !== "boolean" ||
        (entry.event === "COMMAND_NOT_DISPATCHED" &&
          (entry.uncertain !== false ||
            !this.validNonDispatchEvidence(entry, reservation)))
      )
        fail("LEASE_RESULT_HISTORY_INVALID");
      reservation.finished = true;
      reservation.uncertain = entry.uncertain;
    } else if (entry.event === "FAILURE") {
      const categories: readonly unknown[] = [
        "PROCESS",
        "ACQUISITION",
        "BOOTSTRAP",
        "SAFETY",
        "AUTHORIZATION",
        "EVIDENCE",
      ];
      if (
        !categories.includes(entry.category) ||
        typeof entry.code !== "string" ||
        !/^[A-Z0-9_]{1,100}$/.test(entry.code)
      )
        fail("LEASE_FAILURE_HISTORY_INVALID");
      this.retainedFailures.push({
        sequence: entry.seq,
        timestamp: entry.time,
        category: entry.category as LeaseFailure["category"],
        code: entry.code,
        evidence: structuredClone(object(entry.evidence)),
      });
    }
    this.sequence = entry.seq;
    this.head = hash;
    this.last = entry;
  }
  private validNonDispatchEvidence(
    entry: Fields,
    reservation: Reservation,
  ): boolean {
    const keys = [
      "event",
      "hash",
      "owner",
      "previousSha256",
      "reason",
      "reservation",
      "runId",
      "seq",
      "session",
      "time",
      "token",
      "uncertain",
      "version",
    ];
    if (entry.provenance !== undefined) keys.push("provenance");
    if (entry.attemptId !== undefined) keys.push("attemptId");
    if (Object.keys(entry).sort().join(",") !== keys.sort().join(","))
      return false;
    if (reservation.attemptId !== undefined)
      return (
        entry.attemptId === reservation.attemptId &&
        entry.provenance === "TRUSTED_PRE_DISPATCH_GATE" &&
        isDockerDispatchRefusalReason(entry.reason)
      );
    if (entry.attemptId !== undefined) return false;
    if (
      entry.reason === "AUTHORITY_EXPIRED_BEFORE_DISPATCH" &&
      (entry.provenance === undefined ||
        entry.provenance === "ADAPTER_AUTHORITY_CHECK")
    )
      return true;
    return (
      entry.provenance === "TRUSTED_PRE_DISPATCH_GATE" &&
      isDockerDispatchRefusalReason(entry.reason)
    );
  }
  async event(event: string, fields: Fields = {}): Promise<number> {
    if (event === "COMMAND_NOT_DISPATCHED")
      fail("LEASE_RESULT_HISTORY_INVALID");
    return this.#append(event, fields);
  }
  async #append(event: string, fields: Fields): Promise<number> {
    if (this.closed || this.damaged) fail("LEASE_JOURNAL_UNAVAILABLE");
    for (const key of [
      "version",
      "seq",
      "time",
      "event",
      "hash",
      "previousSha256",
      "session",
    ])
      if (Object.hasOwn(fields, key)) fail("LEASE_JOURNAL_RESERVED_FIELD");
    for (const key of ["owner", "runId", "token"] as const)
      if (Object.hasOwn(fields, key) && fields[key] !== this.identity[key])
        fail("LEASE_JOURNAL_IDENTITY_MISMATCH");
    const body = {
      ...fields,
      version: 2,
      seq: this.sequence + 1,
      time: this.now(),
      event,
      ...this.identity,
      session: this.session,
      previousSha256: this.head,
    };
    const entry = { ...body, hash: digest(canonical(body)) };
    const bytes = `${JSON.stringify(entry)}\n`;
    if (
      Buffer.byteLength(bytes) > 65536 ||
      this.wireBytes + Buffer.byteLength(bytes) > MAX_BYTES
    )
      fail("LEASE_JOURNAL_LIMIT");
    try {
      const path = join(this.directory, "journal.jsonl");
      const file = await open(path, this.fileState ? "a" : "wx");
      try {
        if (this.fileState && !sameFile(this.fileState, await file.stat()))
          fail("LEASE_JOURNAL_DRIFT");
        await file.writeFile(bytes);
        await file.sync();
        const current = await file.stat();
        if (!sameFile(current, await lstat(path))) fail("LEASE_JOURNAL_DRIFT");
        this.fileState = current;
      } finally {
        await file.close();
      }
      this.accept(entry);
      this.wireBytes += Buffer.byteLength(bytes);
      return entry.seq;
    } catch {
      this.damaged = true;
      throw new LeaseJournalError("LEASE_JOURNAL_WRITE_UNCERTAIN");
    }
  }
  async bindGrant(
    grantDigest: string,
    maximum: number,
    expiresAt: number,
  ): Promise<void> {
    if (!HASH.test(grantDigest) || expiresAt <= this.now())
      fail("CLEANUP_GRANT_EXPIRED");
    const existing = this.accounts.get(grantDigest);
    if (existing) {
      if (this.latestGrant !== grantDigest) fail("CLEANUP_GRANT_SUPERSEDED");
      if (existing.maximum !== maximum || existing.expiresAt !== expiresAt)
        fail("CLEANUP_GRANT_BINDING_MISMATCH");
      if (existing.used >= existing.maximum) fail("CLEANUP_GRANT_EXHAUSTED");
      return;
    }
    await this.event("GRANT_BOUND", {
      grantDigest,
      maximum,
      expiresAt,
      supersedes: this.latestGrant,
    });
  }
  async reserve(
    grantDigest: string,
    command: string,
    destructive: boolean,
  ): Promise<number> {
    const account = this.accounts.get(grantDigest);
    if (!account || this.latestGrant !== grantDigest)
      fail("CLEANUP_GRANT_UNBOUND_OR_SUPERSEDED");
    if (account.expiresAt <= this.now()) fail("CLEANUP_GRANT_EXPIRED");
    if (account.used >= account.maximum) fail("CLEANUP_GRANT_EXHAUSTED");
    // Mint before the durable append; an append failure burns the identifier.
    const attemptId = randomUUID();
    const reservation = await this.event("COMMAND_RESERVED", {
      grantDigest,
      ordinal: account.used + 1,
      command,
      destructive,
      attemptId,
    });
    const binding: DockerDispatchBinding = Object.freeze({
      journal: this,
      ...this.identity,
      reservation,
      grantDigest,
      attemptId,
    });
    this.#dispatchAttempts.set(reservation, {
      attempt: createDockerDispatchAttempt(binding),
      scope: binding,
    });
    return reservation;
  }
  async dispatchCommand(
    reservation: number | undefined,
    transport: DockerCommandTransport,
    executable: string,
    args: readonly string[],
    options: Parameters<DockerCommandTransport>[2],
    gate: Parameters<typeof dispatchBoundDockerCommand>[5],
    assertAuthority: () => void,
  ): Promise<DockerCommandOutcome> {
    if (this.closed || this.damaged) fail("LEASE_JOURNAL_UNAVAILABLE");
    let stored: {
      attempt: DockerDispatchAttempt;
      scope: DockerDispatchBinding;
    };
    if (reservation !== undefined) {
      const record = this.reservations.get(reservation);
      const capability = this.#dispatchAttempts.get(reservation);
      if (
        !record ||
        record.finished ||
        record.uncertain ||
        !capability ||
        this.latestGrant !== record.digest ||
        capability.scope.journal !== this ||
        capability.scope.owner !== this.identity.owner ||
        capability.scope.runId !== this.identity.runId ||
        capability.scope.token !== this.identity.token ||
        capability.scope.reservation !== reservation ||
        capability.scope.grantDigest !== record.digest ||
        capability.scope.attemptId !== record.attemptId
      )
        fail("LEASE_RESERVATION_UNAVAILABLE");
      stored = capability;
    } else {
      const attemptId = randomUUID();
      const binding: DockerDispatchBinding = Object.freeze({
        journal: this,
        ...this.identity,
        reservation: null,
        grantDigest: null,
        attemptId,
      });
      stored = {
        attempt: createDockerDispatchAttempt(binding),
        scope: binding,
      };
    }
    return dispatchBoundDockerCommand(
      stored.attempt,
      transport,
      executable,
      args,
      options,
      gate,
      assertAuthority,
    );
  }
  async commandResult(
    reservation: number,
    receipt: Fields,
    uncertain: boolean,
  ): Promise<void> {
    await this.event("COMMAND_RESULT", { reservation, ...receipt, uncertain });
  }
  async notDispatched(
    reservation: number,
    evidence: KnownDockerCommandOutcome,
  ): Promise<void> {
    if (this.closed || this.damaged) fail("LEASE_JOURNAL_UNAVAILABLE");
    const record = this.reservations.get(reservation);
    const stored = this.#dispatchAttempts.get(reservation);
    if (
      !record ||
      record.finished ||
      !stored ||
      this.latestGrant !== record.digest ||
      stored.scope.journal !== this ||
      stored.scope.owner !== this.identity.owner ||
      stored.scope.runId !== this.identity.runId ||
      stored.scope.token !== this.identity.token ||
      stored.scope.reservation !== reservation ||
      stored.scope.grantDigest !== record.digest ||
      stored.scope.attemptId !== record.attemptId
    )
      fail("LEASE_RESERVATION_UNAVAILABLE");
    if (!consumeDockerNonDispatch(evidence, stored.attempt, stored.scope))
      fail("LEASE_RESULT_HISTORY_INVALID");
    this.#dispatchAttempts.delete(reservation);
    await this.#append("COMMAND_NOT_DISPATCHED", {
      reservation,
      uncertain: false,
      attemptId: evidence.attemptId,
      reason: evidence.reason,
      provenance: evidence.provenance,
    });
  }
  async failure(
    category: LeaseFailure["category"],
    code: string,
    evidence: Fields,
  ): Promise<void> {
    await this.event("FAILURE", {
      category,
      code,
      evidence: structuredClone(evidence),
    });
  }
  async close(snapshot: Fields): Promise<JournalCheckpoint> {
    await this.event("SUPERVISOR_RELEASED", {
      snapshot: structuredClone(snapshot),
    });
    this.closed = true;
    await unlink(join(this.directory, "supervisor.lock"));
    return Object.freeze({ ...this.identity, journalSha256: this.head });
  }
  async releaseComplete(): Promise<void> {
    await this.event("SUPERVISOR_COMPLETED");
    this.closed = true;
    await unlink(join(this.directory, "supervisor.lock"));
  }
}
