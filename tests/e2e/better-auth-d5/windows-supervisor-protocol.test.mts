import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  canonicalSupervisorValue,
  openSupervisorChannel,
  parseSupervisorMessage,
  parseSupervisorPlan,
  readSupervisorFile,
  type SupervisorPlan,
} from "./windows-supervisor-protocol.mts";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const owner = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const request = {
  daemonId: "daemon-id",
  endpoint: "npipe:////./pipe/docker_engine",
  files: [],
  image: `postgres:16.15-alpine@sha256:${"a".repeat(64)}`,
  journalDirectory: "JOURNAL",
  leaseId: owner,
  operation: "acquire",
  operator: "operator",
  requiredTests: [],
  resolvedImageId: `sha256:${"b".repeat(64)}`,
};
async function sandbox(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "d5 supervisor protocol-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("bounded protocol file reads require a stable regular file and enforce the byte limit", async () => {
  await sandbox(async (root) => {
    const file = resolve(root, "input.json");
    await writeFile(file, '{"ok":true}');
    assert.equal(await readSupervisorFile(file, 32), '{"ok":true}');
    await assert.rejects(
      readSupervisorFile(file, 4),
      /SUPERVISOR_INPUT_INVALID/,
    );
    const directory = resolve(root, "linked-directory");
    await mkdir(directory);
    const link = resolve(root, "input-link.json");
    await symlink(directory, link, "junction");
    await assert.rejects(
      readSupervisorFile(link, 32),
      /SUPERVISOR_INPUT_INVALID/,
    );
    const invalidUtf8 = resolve(root, "invalid-utf8.json");
    await writeFile(invalidUtf8, new Uint8Array([0xff]));
    await assert.rejects(
      readSupervisorFile(invalidUtf8, 32),
      /SUPERVISOR_INPUT_INVALID/,
    );
  });
});
function planFor(root: string): SupervisorPlan {
  const requestBytes = JSON.stringify({
    ...request,
    journalDirectory: resolve(root, "journal"),
  });
  return {
    approvalDirectory: resolve(root, "approval"),
    candidateRoot: resolve(root, "candidate"),
    channelDirectory: resolve(root, "channel"),
    checkpoint: null,
    contract: "D5-WINDOWS-SUPERVISOR-v1",
    evidenceDirectory: resolve(root, "evidence"),
    migrationSha256: "c".repeat(64),
    mode: "acquire-bootstrap",
    requestBytes,
    requestSha256: digest(requestBytes),
    sessionId,
    sourceSha256: "d".repeat(64),
    timeoutMs: 5000,
  };
}
test("canonical supervisor values sort object keys and reject unsupported values", () => {
  assert.equal(
    canonicalSupervisorValue({ z: [2, { b: true, a: null }], a: "x" }),
    '{"a":"x","z":[2,{"a":null,"b":true}]}',
  );
  assert.throws(
    () => canonicalSupervisorValue(Number.NaN),
    /SUPERVISOR_VALUE_INVALID/,
  );
  assert.throws(
    () => canonicalSupervisorValue(undefined),
    /SUPERVISOR_VALUE_INVALID/,
  );
});
test("plan parser pins raw bytes and enforces exact shape and request operation", async () => {
  await sandbox(async (root) => {
    const body = planFor(root);
    const bytes = JSON.stringify(body);
    assert.equal(
      parseSupervisorPlan(bytes, digest(bytes)).sessionId,
      sessionId,
    );
    assert.throws(
      () => parseSupervisorPlan(bytes, "0".repeat(64)),
      /SUPERVISOR_PLAN_PIN_INVALID/,
    );
    const extra = JSON.stringify({ ...body, executable: "docker" });
    assert.throws(
      () => parseSupervisorPlan(extra, digest(extra)),
      /SUPERVISOR_PLAN_INVALID/,
    );
    const bootstrapRequest = JSON.stringify({
      ...request,
      operation: "bootstrap",
      journalDirectory: resolve(root, "journal"),
    });
    const wrongOperation = JSON.stringify({
      ...body,
      requestBytes: bootstrapRequest,
      requestSha256: digest(bootstrapRequest),
    });
    assert.throws(
      () => parseSupervisorPlan(wrongOperation, digest(wrongOperation)),
      /SUPERVISOR_PLAN_INVALID/,
    );
    const checkpoint = {
      owner,
      runId: "33333333-3333-4333-8333-333333333333",
      token: "44444444-4444-4444-8444-444444444444",
      journalSha256: "e".repeat(64),
    };
    const cleanupPlan = JSON.stringify({
      ...body,
      mode: "cleanup-only",
      checkpoint,
    });
    assert.equal(
      parseSupervisorPlan(cleanupPlan, digest(cleanupPlan)).checkpoint?.owner,
      owner,
    );
    const mismatchedOwner = JSON.stringify({
      ...body,
      mode: "cleanup-only",
      checkpoint: {
        ...checkpoint,
        owner: "55555555-5555-4555-8555-555555555555",
      },
    });
    assert.throws(
      () => parseSupervisorPlan(mismatchedOwner, digest(mismatchedOwner)),
      /SUPERVISOR_PLAN_INVALID/,
    );
  });
});
test("command approval binds raw command and canonical grant and rejects altered authority", () => {
  const grant = {
    contract: "G3-C",
    digestInput: { operation: "acquire", owner },
  };
  const message = {
    contract: "D5-WINDOWS-COMMAND-v1",
    sessionId,
    sequence: 1,
    operation: "acquire",
    grant,
  };
  const bytes = JSON.stringify(message);
  const grantSha256 = digest(canonicalSupervisorValue(grant.digestInput));
  const authority = JSON.stringify({
    contract: "D5-WINDOWS-AUTHORITY-v1",
    sessionId,
    sequence: 1,
    messageSha256: digest(bytes),
    grantSha256,
  });
  assert.equal(
    parseSupervisorMessage(bytes, authority, sessionId, 1).grantSha256,
    grantSha256,
  );
  assert.throws(
    () => parseSupervisorMessage(bytes, authority, sessionId, 2),
    /SUPERVISOR_COMMAND_INVALID/,
  );
  const altered = authority.replace(digest(bytes), "0".repeat(64));
  assert.throws(
    () => parseSupervisorMessage(bytes, altered, sessionId, 1),
    /SUPERVISOR_AUTHORITY_INVALID/,
  );
  const withPath = JSON.stringify({ ...message, executable: "docker" });
  assert.throws(
    () => parseSupervisorMessage(withPath, authority, sessionId, 1),
    /SUPERVISOR_COMMAND_INVALID/,
  );
});
test("channel requires a fresh monotonic heartbeat, honors cancellation and syncs evidence", async () => {
  await sandbox(async (root) => {
    const body = planFor(root);
    for (const name of [
      "candidate",
      "channel",
      "approval",
      "journal",
      "trusted",
    ])
      await mkdir(resolve(root, name));
    const channel = await openSupervisorChannel(body, resolve(root, "trusted"));
    const evidence = resolve(root, "evidence");
    const heartbeatPath = resolve(root, "channel", "heartbeat.json");
    const now = Date.now();
    await writeFile(
      heartbeatPath,
      JSON.stringify({
        contract: "D5-WINDOWS-HEARTBEAT-v1",
        sessionId,
        counter: 1,
        time: now,
      }),
    );
    await channel.assertLive();
    await writeFile(
      heartbeatPath,
      JSON.stringify({
        contract: "D5-WINDOWS-HEARTBEAT-v1",
        sessionId,
        counter: 0,
        time: now,
      }),
    );
    await assert.rejects(channel.assertLive(), /SUPERVISOR_DISCONNECTED/);
    await writeFile(
      heartbeatPath,
      JSON.stringify({
        contract: "D5-WINDOWS-HEARTBEAT-v1",
        sessionId,
        counter: 2,
        time: Date.now(),
      }),
    );
    await writeFile(
      resolve(root, "channel", "cancel.json"),
      JSON.stringify({ contract: "D5-WINDOWS-CANCEL-v1", sessionId }),
    );
    await assert.rejects(channel.assertLive(), /SUPERVISOR_CANCELLED/);
    await rm(resolve(root, "channel", "cancel.json"));
    const status = {
      contract: "D5-WINDOWS-STATUS-v1",
      sessionId,
      leaseId: owner,
      state: "WAITING_APPROVAL",
      reason: null,
      identity: null,
      failureCount: 0,
      cleanup: "NOT_RUN",
      checkpointSha256: null,
    } as const;
    await channel.status(status);
    const context = JSON.parse(
      await readFile(resolve(evidence, "context.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(context).sort(),
      [
        "contract",
        "journalDirectory",
        "leaseId",
        "migrationSha256",
        "mode",
        "sessionId",
        "sourceSha256",
      ].sort(),
    );
    assert.equal(context.leaseId, owner);
    assert.equal(
      JSON.parse(await readFile(resolve(evidence, "status.json"), "utf8"))
        .state,
      "WAITING_APPROVAL",
    );
    assert.match(
      await readFile(resolve(evidence, "events.jsonl"), "utf8"),
      /"type":"STATUS"/,
    );
    await channel.close();
    await assert.rejects(openSupervisorChannel(body, resolve(root, "trusted")));
  });
});

test("mailbox commands require separate approval and cannot skip or replay a sequence", async () => {
  await sandbox(async (root) => {
    const plan = planFor(root);
    for (const name of [
      "candidate",
      "channel",
      "approval",
      "journal",
      "trusted",
    ])
      await mkdir(resolve(root, name));
    const channel = await openSupervisorChannel(plan, resolve(root, "trusted"));
    try {
      await writeFile(
        resolve(plan.channelDirectory, "heartbeat.json"),
        JSON.stringify({
          contract: "D5-WINDOWS-HEARTBEAT-v1",
          sessionId,
          counter: 1,
          time: Date.now(),
        }),
      );
      const commandPath = resolve(plan.channelDirectory, "command.json");
      const authorityPath = resolve(plan.approvalDirectory, "authority.json");
      const message = (sequence: number) =>
        JSON.stringify({
          contract: "D5-WINDOWS-COMMAND-v1",
          sessionId,
          sequence,
          operation: "acquire",
          grant: {
            contract: "G3-C",
            digestInput: { operation: "acquire", owner, sequence },
          },
        });
      const authority = (bytes: string, sequence: number) =>
        JSON.stringify({
          contract: "D5-WINDOWS-AUTHORITY-v1",
          sessionId,
          sequence,
          messageSha256: digest(bytes),
          grantSha256: digest(
            canonicalSupervisorValue(JSON.parse(bytes).grant.digestInput),
          ),
        });
      const first = message(1);
      await writeFile(commandPath, first);
      assert.equal(await channel.next(1), null);
      await writeFile(authorityPath, authority(first, 1));
      assert.equal((await channel.next(1))?.message.sequence, 1);
      assert.equal(await channel.next(2), null);
      const skipped = message(3);
      await writeFile(authorityPath, authority(skipped, 3));
      await writeFile(commandPath, skipped);
      await assert.rejects(channel.next(2), /SUPERVISOR_COMMAND_INVALID/);
      const second = message(2);
      await writeFile(authorityPath, authority(second, 2));
      await writeFile(commandPath, second);
      assert.equal((await channel.next(2))?.message.sequence, 2);
      await writeFile(authorityPath, authority(first, 1));
      await writeFile(commandPath, first);
      await assert.rejects(channel.next(3), /SUPERVISOR_COMMAND_INVALID/);
    } finally {
      await channel.close();
    }
  });
});

test("disconnected owner and reserved Windows device paths refuse without operations", async () => {
  await sandbox(async (root) => {
    const plan = planFor(root);
    for (const name of [
      "candidate",
      "channel",
      "approval",
      "journal",
      "trusted",
    ])
      await mkdir(resolve(root, name));
    const channel = await openSupervisorChannel(plan, resolve(root, "trusted"));
    try {
      await assert.rejects(channel.assertLive(), /SUPERVISOR_DISCONNECTED/);
      await writeFile(
        resolve(plan.channelDirectory, "heartbeat.json"),
        JSON.stringify({
          contract: "D5-WINDOWS-HEARTBEAT-v1",
          sessionId,
          counter: 1,
          time: Date.now() - 4000,
        }),
      );
      await assert.rejects(channel.assertLive(), /SUPERVISOR_DISCONNECTED/);
      await assert.rejects(
        readSupervisorFile(resolve(root, "con.txt"), 32),
        /SUPERVISOR_PATH_INVALID/,
      );
    } finally {
      await channel.close();
    }
  });
});
