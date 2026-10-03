import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../../test/database-harness.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";
import { createAnalyticsSnapshotService } from "../analytics/analytics-snapshot-service.ts";
import {
  createAiInsightJob,
  type AiInsightJobInput,
} from "./ai-insight-job.ts";
import type { AiProvider } from "./ai-provider.ts";
import { createOpenRouterProvider } from "./openrouter-provider.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);
const key = "test-only-openrouter-key";

async function setup() {
  const organization = await prisma.organization.create({
    data: {
      name: `Private ${randomUUID()}`,
      reportingTimezone: "Asia/Bangkok",
    },
  });
  const branch = await prisma.branch.create({
    data: {
      organizationId: organization.id,
      code: "B",
      name: "Private Branch",
    },
  });
  return { organization, branch };
}

function input(
  organizationId: string,
  scope: AiInsightJobInput["scope"] = { kind: "organization" },
): AiInsightJobInput {
  return {
    organizationId,
    scope,
    from: "2026-09-20",
    to: "2026-09-21",
    granularity: "day",
    reportingTimezone: "Asia/Bangkok",
    periodStartInclusive: new Date("2026-09-19T17:00:00.000Z"),
    periodEndExclusive: new Date("2026-09-20T17:00:00.000Z"),
  };
}

function completion(
  model = "example/routed-free-model",
  text = "Sales were zero for the completed period.",
  usage = true,
) {
  return new Response(
    JSON.stringify({
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: text },
        },
      ],
      ...(usage
        ? {
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              total_tokens: 20,
              cost: 0.000012,
            },
          }
        : {}),
    }),
    { status: 200 },
  );
}

function provider(responses: Response[]) {
  const calls: string[] = [];
  const fetchImplementation = vi.fn<typeof fetch>(async (_url, options) => {
    calls.push(String(options?.body));
    const response = responses.shift();
    if (response === undefined) throw new Error("Unexpected provider call");
    return response;
  });
  return {
    calls,
    fetchImplementation,
    adapter: createOpenRouterProvider({ apiKey: key, fetchImplementation }),
  };
}

describe("idempotent AI insight job", () => {
  beforeEach(async () => resetTestDatabase(environment));
  afterAll(async () => {
    await resetTestDatabase(environment);
    await prisma.$disconnect();
  });

  it("fails safety-only output without retry, content persistence, or paid fallback", async () => {
    const { organization } = await setup();
    const external = provider([
      completion(
        "nvidia/nemotron-3.5-content-safety:free",
        "User Safety: safe",
      ),
    ]);
    const run = createAiInsightJob(prisma, external.adapter);
    const report = await run(input(organization.id));
    expect(report).toMatchObject({
      state: "FAILED",
      failureCategory: "INVALID_RESPONSE",
      content: null,
      attemptCount: 1,
    });
    expect((await run(input(organization.id))).id).toBe(report.id);
    expect(external.calls).toHaveLength(1);
    expect(JSON.parse(external.calls[0]!).model).toBe("openrouter/free");
    const stored = await prisma.aiInsightReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(stored.content).toBeNull();
    expect(
      await prisma.aiInsightReport.count({ where: { state: "SUCCEEDED" } }),
    ).toBe(0);
    const attempt = await prisma.aiInsightAttempt.findFirstOrThrow();
    expect(attempt).toMatchObject({
      requestedModel: "openrouter/free",
      actualModel: "nvidia/nemotron-3.5-content-safety:free",
    });
    const snapshot = await prisma.analyticsSnapshot.findUniqueOrThrow({
      where: { id: report.snapshotId },
    });
    expect(snapshot.payload).toMatchObject({
      sales: { saleCount: 0, netSalesAmount: "0.00", refundAmount: "0.00" },
    });
  });

  it("pins an Organization zero snapshot, records one actual call, and reuses immutable success", async () => {
    const { organization } = await setup();
    const external = provider([completion()]);
    const run = createAiInsightJob(prisma, external.adapter);
    const first = await run(input(organization.id));
    const second = await run(input(organization.id));
    const changedProvider = provider([completion("example/other-free-model")]);
    const afterDeployment = await createAiInsightJob(
      prisma,
      changedProvider.adapter,
    )(input(organization.id));
    expect(first.id).toBe(second.id);
    expect(afterDeployment.id).toBe(first.id);
    expect(changedProvider.calls).toHaveLength(0);
    expect(first).toMatchObject({
      state: "SUCCEEDED",
      scope: "ORGANIZATION",
      scopeKey: "organization",
      branchId: null,
      schemaVersion: "analytics-snapshot-v1",
      metricDefinitionVersion: "analytics-v1",
      promptVersion: "ai-business-summary-prompt-v1",
      provider: "openrouter",
      actualModel: "example/routed-free-model",
      attemptCount: 1,
      content: "Sales were zero for the completed period.",
    });
    expect(external.calls).toHaveLength(1);
    const sentPrompt = JSON.parse(external.calls[0]!).messages[0]
      .content as string;
    expect(sentPrompt).toContain('"netSalesAmount":"0.00"');
    expect(external.calls[0]).not.toContain(organization.id);
    expect(external.calls[0]).not.toContain(organization.name);
    const snapshot = await prisma.analyticsSnapshot.findUniqueOrThrow({
      where: { id: first.snapshotId },
    });
    expect(snapshot.payload).toMatchObject({
      sales: { saleCount: 0, netSalesAmount: "0.00" },
    });
    expect(first.sourceCutoff).toEqual(snapshot.sourceCutoff);
    expect(await prisma.aiInsightReport.count()).toBe(1);
    const attempt = await prisma.aiInsightAttempt.findFirstOrThrow();
    expect(attempt).toMatchObject({
      ordinal: 1,
      provider: "openrouter",
      requestedModel: "openrouter/free",
      actualModel: "example/routed-free-model",
      promptTokens: 12n,
      completionTokens: 8n,
      totalTokens: 20n,
      cost: "0.000012",
    });
    expect(attempt.finishedAt).not.toBeNull();
    await expect(
      prisma.aiInsightReport.update({
        where: { id: first.id },
        data: { content: "replacement" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.aiInsightReport.update({
        where: { id: first.id },
        data: { promptVersion: "new" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.aiInsightAttempt.update({
        where: { id: attempt.id },
        data: { requestedModel: "new" },
      }),
    ).rejects.toThrow();
  });

  it("keeps Branch/Organization identities distinct and enforces uniqueness and tenancy in PostgreSQL", async () => {
    const first = await setup();
    const second = await setup();
    const external = provider([completion(), completion()]);
    const run = createAiInsightJob(prisma, external.adapter);
    const org = await run(input(first.organization.id));
    const branch = await run(
      input(first.organization.id, {
        kind: "branch",
        branchId: first.branch.id,
      }),
    );
    expect(org.id).not.toBe(branch.id);
    expect(branch).toMatchObject({
      scope: "BRANCH",
      scopeKey: first.branch.id,
      branchId: first.branch.id,
    });
    expect(
      (
        await run(
          input(first.organization.id, {
            kind: "branch",
            branchId: first.branch.id,
          }),
        )
      ).id,
    ).toBe(branch.id);
    expect(external.calls).toHaveLength(2);
    expect(external.calls[1]).not.toContain(first.branch.id);
    await expect(
      prisma.aiInsightReport.create({
        data: {
          organizationId: org.organizationId,
          branchId: null,
          scope: "ORGANIZATION",
          scopeKey: "organization",
          cadence: org.cadence,
          reportingTimezone: org.reportingTimezone,
          periodStartInclusive: org.periodStartInclusive,
          periodEndExclusive: org.periodEndExclusive,
          snapshotId: org.snapshotId,
          schemaVersion: org.schemaVersion,
          metricDefinitionVersion: org.metricDefinitionVersion,
          sourceCutoff: org.sourceCutoff,
          promptVersion: org.promptVersion,
          claimToken: randomUUID(),
          claimExpiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.aiInsightReport.create({
        data: {
          organizationId: first.organization.id,
          branchId: second.branch.id,
          scope: "BRANCH",
          scopeKey: second.branch.id,
          cadence: "WEEKLY",
          reportingTimezone: org.reportingTimezone,
          periodStartInclusive: org.periodStartInclusive,
          periodEndExclusive: org.periodEndExclusive,
          snapshotId: org.snapshotId,
          schemaVersion: org.schemaVersion,
          metricDefinitionVersion: org.metricDefinitionVersion,
          sourceCutoff: org.sourceCutoff,
          promptVersion: org.promptVersion,
          claimToken: randomUUID(),
          claimExpiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
  });

  it("separates cadence, exact period, and reporting timezone identities", async () => {
    const { organization } = await setup();
    const external = provider([
      completion(),
      completion(),
      completion(),
      completion(),
    ]);
    const run = createAiInsightJob(prisma, external.adapter);
    const daily = await run(input(organization.id));
    const weekly = await run({
      ...input(organization.id),
      from: "2026-09-14",
      to: "2026-09-21",
      granularity: "week",
      periodStartInclusive: new Date("2026-09-13T17:00:00.000Z"),
    });
    const otherPeriod = await run({
      ...input(organization.id),
      from: "2026-09-19",
      to: "2026-09-20",
      periodStartInclusive: new Date("2026-09-18T17:00:00.000Z"),
      periodEndExclusive: new Date("2026-09-19T17:00:00.000Z"),
    });
    await prisma.organization.update({
      where: { id: organization.id },
      data: { reportingTimezone: "Etc/UTC" },
    });
    const otherZone = await run({
      ...input(organization.id),
      reportingTimezone: "Etc/UTC",
      periodStartInclusive: new Date("2026-09-20T00:00:00.000Z"),
      periodEndExclusive: new Date("2026-09-21T00:00:00.000Z"),
    });
    expect(
      new Set([daily.id, weekly.id, otherPeriod.id, otherZone.id]).size,
    ).toBe(4);
    expect(await prisma.aiInsightReport.count()).toBe(4);
    expect(external.calls).toHaveLength(4);
  });

  it("records three free-router calls and the actual routed model", async () => {
    const { organization } = await setup();
    const external = provider([
      new Response("", { status: 503 }),
      new Response("", { status: 503 }),
      completion("example/third-free-model:free", "Sales were zero.", false),
    ]);
    const result = await createAiInsightJob(
      prisma,
      external.adapter,
    )(input(organization.id));
    expect(result).toMatchObject({
      state: "SUCCEEDED",
      attemptCount: 3,
      actualModel: "example/third-free-model:free",
    });
    expect(external.calls.map((body) => JSON.parse(body).model)).toEqual([
      "openrouter/free",
      "openrouter/free",
      "openrouter/free",
    ]);
    const attempts = await prisma.aiInsightAttempt.findMany({
      orderBy: { ordinal: "asc" },
    });
    expect(attempts.map((attempt) => attempt.failureCategory)).toEqual([
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_UNAVAILABLE",
      null,
    ]);
    expect(attempts[2]?.actualModel).toBe("example/third-free-model:free");
    expect(attempts[2]?.cost).toBeNull();
    expect(attempts[2]?.totalTokens).toBeNull();
  });

  it("records a transient primary retry without fallback", async () => {
    const { organization } = await setup();
    const external = provider([
      new Response("", { status: 503 }),
      completion("example/routed-free-model", "Sales were zero.", false),
    ]);
    const report = await createAiInsightJob(
      prisma,
      external.adapter,
    )(input(organization.id));
    expect(report).toMatchObject({ state: "SUCCEEDED", attemptCount: 2 });
    expect(external.calls).toHaveLength(2);
    expect(
      (
        await prisma.aiInsightAttempt.findMany({ orderBy: { ordinal: "asc" } })
      ).map((attempt) => attempt.requestedModel),
    ).toEqual(["openrouter/free", "openrouter/free"]);
  });

  it("persists safe pre-call, nonretryable, and invalid-prose failures", async () => {
    const auth = await setup();
    const noKey = createOpenRouterProvider({
      apiKey: undefined,
      fetchImplementation: vi.fn<typeof fetch>(),
    });
    const authReport = await createAiInsightJob(
      prisma,
      noKey,
    )(input(auth.organization.id));
    expect(authReport).toMatchObject({
      state: "FAILED",
      failureCategory: "AUTHENTICATION",
      attemptCount: 0,
      provider: null,
      actualModel: null,
      content: null,
    });
    expect(await prisma.aiInsightAttempt.count()).toBe(0);
    await expect(
      prisma.aiInsightReport.update({
        where: { id: authReport.id },
        data: { failureCategory: "PROVIDER_ERROR" },
      }),
    ).rejects.toThrow();

    const bad = await setup();
    const nonretryable = provider([
      new Response("secret provider error", { status: 401 }),
    ]);
    const badReport = await createAiInsightJob(
      prisma,
      nonretryable.adapter,
    )(input(bad.organization.id));
    expect(badReport).toMatchObject({
      state: "FAILED",
      failureCategory: "AUTHENTICATION",
      attemptCount: 1,
      content: null,
    });
    expect(nonretryable.calls).toHaveLength(1);
    expect(JSON.stringify(badReport)).not.toContain("secret provider error");

    const invalid = await setup();
    const invalidOutput = provider([
      completion(
        "example/routed-free-model",
        "<script>private raw output</script>",
      ),
    ]);
    const invalidReport = await createAiInsightJob(
      prisma,
      invalidOutput.adapter,
    )(input(invalid.organization.id));
    expect(invalidReport).toMatchObject({
      state: "FAILED",
      failureCategory: "INVALID_RESPONSE",
      attemptCount: 1,
      content: null,
    });
    expect(JSON.stringify(invalidReport)).not.toContain("private raw output");
  });

  it("lets duplicate workers observe one active claim without another provider call", async () => {
    const { organization } = await setup();
    let started!: () => void;
    let release!: () => void;
    const atFetch = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      started();
      await blocked;
      return completion();
    });
    const run = createAiInsightJob(
      prisma,
      createOpenRouterProvider({ apiKey: key, fetchImplementation }),
    );
    const first = run(input(organization.id));
    await atFetch;
    const duplicate = await run(input(organization.id));
    expect(duplicate).toMatchObject({
      state: "IN_PROGRESS",
      attemptCount: null,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    release();
    const done = await first;
    expect(done.state).toBe("SUCCEEDED");
    expect((await run(input(organization.id))).id).toBe(done.id);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("converges concurrent first claims on one database identity", async () => {
    const { organization } = await setup();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      await blocked;
      return completion();
    });
    const run = createAiInsightJob(
      prisma,
      createOpenRouterProvider({ apiKey: key, fetchImplementation }),
    );
    const both = Promise.all([
      run(input(organization.id)),
      run(input(organization.id)),
    ]);
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledOnce(), {
      timeout: 10_000,
    });
    release();
    const [left, right] = await both;
    expect(left.id).toBe(right.id);
    expect(await prisma.aiInsightReport.count()).toBe(1);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("recovers only a pre-call stale claim and fails closed after an ambiguous reservation", async () => {
    const first = await setup();
    const beforeCall: AiProvider = {
      generate: async () => {
        throw new Error("private interruption");
      },
    };
    await expect(
      createAiInsightJob(prisma, beforeCall)(input(first.organization.id)),
    ).rejects.toThrow("AI insight execution interrupted.");
    const claim = await prisma.aiInsightReport.findFirstOrThrow({
      where: { organizationId: first.organization.id },
    });
    expect(claim.attemptCount).toBe(0);
    await prisma.aiInsightReport.update({
      where: { id: claim.id },
      data: { claimExpiresAt: new Date(0) },
    });
    const recovered = await createAiInsightJob(
      prisma,
      provider([completion()]).adapter,
    )(input(first.organization.id));
    expect(recovered).toMatchObject({
      id: claim.id,
      state: "SUCCEEDED",
      snapshotId: claim.snapshotId,
    });
    expect(
      await prisma.analyticsSnapshot.count({
        where: { organizationId: first.organization.id },
      }),
    ).toBe(1);

    const second = await setup();
    const ambiguous: AiProvider = {
      generate: async (_input, observer) => {
        await observer?.beforeAttempt({
          provider: "openrouter",
          requestedModel: "openrouter/free",
          attemptNumber: 1,
        });
        throw new Error("private result unknown");
      },
    };
    await expect(
      createAiInsightJob(prisma, ambiguous)(input(second.organization.id)),
    ).rejects.toThrow("AI insight execution interrupted.");
    const pending = await prisma.aiInsightReport.findFirstOrThrow({
      where: { organizationId: second.organization.id },
    });
    expect(pending.attemptCount).toBeNull();
    expect(
      await prisma.aiInsightAttempt.count({ where: { reportId: pending.id } }),
    ).toBe(1);
    await prisma.aiInsightReport.update({
      where: { id: pending.id },
      data: { claimExpiresAt: new Date(0) },
    });
    const forbidden = provider([completion()]);
    const failed = await createAiInsightJob(
      prisma,
      forbidden.adapter,
    )(input(second.organization.id));
    expect(failed).toMatchObject({
      state: "FAILED",
      failureCategory: "INTERRUPTED",
      attemptCount: null,
      content: null,
    });
    expect(forbidden.calls).toHaveLength(0);

    const third = await setup();
    const afterCall: AiProvider = {
      generate: async (_input, observer) => {
        const attempt = {
          provider: "openrouter" as const,
          requestedModel: "openrouter/free" as const,
          attemptNumber: 1,
          durationMilliseconds: 1,
          actualModel: "openrouter/free",
        };
        await observer?.beforeAttempt(attempt);
        await observer?.afterAttempt(attempt);
        throw new Error("crash before terminal persistence");
      },
    };
    await expect(
      createAiInsightJob(prisma, afterCall)(input(third.organization.id)),
    ).rejects.toThrow("AI insight execution interrupted.");
    const known = await prisma.aiInsightReport.findFirstOrThrow({
      where: { organizationId: third.organization.id },
    });
    expect(known.attemptCount).toBe(1);
    await prisma.aiInsightReport.update({
      where: { id: known.id },
      data: { claimExpiresAt: new Date(0) },
    });
    const noReplay = provider([completion()]);
    const stopped = await createAiInsightJob(
      prisma,
      noReplay.adapter,
    )(input(third.organization.id));
    expect(stopped).toMatchObject({
      state: "FAILED",
      failureCategory: "INTERRUPTED",
      attemptCount: 1,
    });
    expect(noReplay.calls).toHaveLength(0);
  });

  it("fails safely when a previously claimed snapshot version is unsupported", async () => {
    const { organization } = await setup();
    const requested = input(organization.id);
    const snapshot =
      await createAnalyticsSnapshotService(prisma).create(requested);
    const report = await prisma.aiInsightReport.create({
      data: {
        organizationId: organization.id,
        branchId: null,
        scope: "ORGANIZATION",
        scopeKey: "organization",
        cadence: snapshot.cadence,
        reportingTimezone: snapshot.reportingTimezone,
        periodStartInclusive: snapshot.periodStartInclusive,
        periodEndExclusive: snapshot.periodEndExclusive,
        snapshotId: snapshot.id,
        schemaVersion: "unsupported-v0",
        metricDefinitionVersion: snapshot.metricDefinitionVersion,
        sourceCutoff: snapshot.sourceCutoff,
        promptVersion: "ai-business-summary-prompt-v1",
        claimToken: randomUUID(),
        claimExpiresAt: new Date(0),
      },
    });
    const external = provider([completion()]);
    const failed = await createAiInsightJob(
      prisma,
      external.adapter,
    )(requested);
    expect(failed).toMatchObject({
      id: report.id,
      state: "FAILED",
      attemptCount: 0,
      failureCategory: "INVALID_REQUEST",
      snapshotId: snapshot.id,
    });
    expect(external.calls).toHaveLength(0);
    expect(await prisma.analyticsSnapshot.count()).toBe(1);
  });

  it("rejects a claimed snapshot from a different scope before provider work", async () => {
    const { organization, branch } = await setup();
    const requested = input(organization.id);
    const snapshot =
      await createAnalyticsSnapshotService(prisma).create(requested);
    const report = await prisma.aiInsightReport.create({
      data: {
        organizationId: organization.id,
        branchId: branch.id,
        scope: "BRANCH",
        scopeKey: branch.id,
        cadence: snapshot.cadence,
        reportingTimezone: snapshot.reportingTimezone,
        periodStartInclusive: snapshot.periodStartInclusive,
        periodEndExclusive: snapshot.periodEndExclusive,
        snapshotId: snapshot.id,
        schemaVersion: snapshot.schemaVersion,
        metricDefinitionVersion: snapshot.metricDefinitionVersion,
        sourceCutoff: snapshot.sourceCutoff,
        promptVersion: "ai-business-summary-prompt-v1",
        claimToken: randomUUID(),
        claimExpiresAt: new Date(0),
      },
    });
    const external = provider([completion()]);
    const failed = await createAiInsightJob(
      prisma,
      external.adapter,
    )(input(organization.id, { kind: "branch", branchId: branch.id }));
    expect(failed).toMatchObject({
      id: report.id,
      state: "FAILED",
      failureCategory: "INVALID_REQUEST",
      attemptCount: 0,
    });
    expect(external.calls).toHaveLength(0);
  });
});
