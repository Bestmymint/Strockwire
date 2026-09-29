import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../../test/database-harness.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";
import {
  createAiInsightJob,
  type AiInsightJobInput,
} from "./ai-insight-job.ts";
import { createAiInsightOrchestrator } from "./ai-insight-orchestrator.ts";
import type { AiProvider } from "./ai-provider.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);
const runAt = new Date("2026-09-29T06:00:00.000Z");
const latestDailyDue = new Date("2026-09-28T23:00:00.000Z");
const justAfterDue = new Date(latestDailyDue.getTime() + 1);

async function branch(
  organizationId: string,
  code: string,
  status: "ACTIVE" | "INACTIVE" = "ACTIVE",
  createdAt = new Date("2026-09-20T00:00:00.000Z"),
) {
  return prisma.branch.create({
    data: {
      organizationId,
      code,
      name: code,
      status,
      createdAt,
      deactivatedAt: status === "INACTIVE" ? createdAt : null,
    },
  });
}

describe("AI insight cadence orchestration", () => {
  beforeEach(async () => resetTestDatabase(environment));
  afterAll(async () => {
    await resetTestDatabase(environment);
    await prisma.$disconnect();
  });

  it("uses immutable Branch history at each due instant and isolates a failed job", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Private organization", reportingTimezone: "Asia/Bangkok" },
    });
    const always = await branch(organization.id, "ALWAYS");
    const deactivatedAfter = await branch(organization.id, "AFTER");
    const deactivatedAt = await branch(organization.id, "AT");
    const activatedAfter = await branch(organization.id, "LATER", "INACTIVE");
    const unknown = await branch(
      organization.id,
      "UNKNOWN",
      "ACTIVE",
      new Date("2026-09-29T00:00:00.000Z"),
    );
    await prisma.branch.update({
      where: { id: deactivatedAfter.id },
      data: {
        status: "INACTIVE",
        deactivatedAt: justAfterDue,
        updatedAt: justAfterDue,
      },
    });
    await prisma.branch.update({
      where: { id: deactivatedAt.id },
      data: {
        status: "INACTIVE",
        deactivatedAt: latestDailyDue,
        updatedAt: latestDailyDue,
      },
    });
    await prisma.branch.update({
      where: { id: activatedAfter.id },
      data: {
        status: "ACTIVE",
        deactivatedAt: null,
        updatedAt: new Date("2026-09-29T00:00:00.000Z"),
      },
    });

    const calls: AiInsightJobInput[] = [];
    const run = createAiInsightOrchestrator(prisma, async (input) => {
      calls.push(input);
      if (
        input.scope.kind === "organization" &&
        input.granularity === "day" &&
        input.to === "2026-09-29"
      ) {
        throw new Error("private provider failure text");
      }
      if (
        input.scope.kind === "branch" &&
        input.scope.branchId === always.id &&
        input.granularity === "day" &&
        input.to === "2026-09-29"
      ) {
        return { state: "FAILED" };
      }
      return { state: "SUCCEEDED" };
    });
    const result = await run(runAt);
    const daily = calls.filter(({ granularity }) => granularity === "day");
    const scopes = (to: string) =>
      daily
        .filter((input) => input.to === to)
        .map(({ scope }) =>
          scope.kind === "organization" ? "organization" : scope.branchId,
        );

    expect(scopes("2026-09-28")).toContain(always.id);
    expect(scopes("2026-09-29")).toContain(always.id);
    expect(scopes("2026-09-29")).toContain(deactivatedAfter.id);
    expect(scopes("2026-09-29")).not.toContain(deactivatedAt.id);
    expect(scopes("2026-09-29")).not.toContain(activatedAfter.id);
    expect(scopes("2026-09-29")).not.toContain(unknown.id);
    expect(scopes("2026-09-29")[0]).toBe("organization");
    expect(daily[0]?.to).toBe("2026-09-28");
    expect(daily.at(-1)?.to).toBe("2026-09-29");
    expect(result.scannedOrganizations).toBe(1);
    expect(result.skippedBranchInactive).toBeGreaterThan(0);
    expect(result.skippedBranchHistoryUnavailable).toBeGreaterThan(0);
    expect(result.failed).toBe(1);
    expect(result.executionErrors).toBe(1);
    expect(result.succeeded).toBe(result.candidateJobs - 2);
    expect(result.candidateJobs).toBeLessThanOrEqual(8 * (1 + 5));
    expect(result.candidateJobs * 3).toBeLessThanOrEqual(24 * (1 + 5));
    expect(JSON.stringify(result)).not.toContain(
      "private provider failure text",
    );
    expect(await prisma.sale.count()).toBe(0);
  });

  it("bounds a long outage to eight period identities per scope", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Private organization" },
    });
    const first = await branch(
      organization.id,
      "FIRST",
      "ACTIVE",
      new Date("2020-01-01T00:00:00.000Z"),
    );
    const second = await branch(
      organization.id,
      "SECOND",
      "ACTIVE",
      new Date("2020-01-01T00:00:00.000Z"),
    );
    const calls: AiInsightJobInput[] = [];
    const run = createAiInsightOrchestrator(prisma, async (input) => {
      calls.push(input);
      return { state: "SUCCEEDED" };
    });
    const result = await run(runAt);
    expect(result.candidateJobs).toBe(8 * (1 + 2));
    expect(result.candidateJobs * 3).toBe(24 * (1 + 2));
    expect(
      calls
        .filter(({ granularity }) => granularity === "day")
        .map(({ to }) => to),
    ).toEqual([...Array(3).fill("2026-09-28"), ...Array(3).fill("2026-09-29")]);
    expect(
      calls
        .filter(({ scope }) => scope.kind === "branch")
        .map(({ scope }) => scope.kind === "branch" && scope.branchId),
    ).toContain(first.id);
    expect(
      calls
        .filter(({ scope }) => scope.kind === "branch")
        .map(({ scope }) => scope.kind === "branch" && scope.branchId),
    ).toContain(second.id);
    expect(calls.some(({ to }) => to === "2026-09-27")).toBe(false);
  });

  it("uses T03 persistence so a repeated run makes no second provider call", async () => {
    const organization = await prisma.organization.create({
      data: { name: "Private organization" },
    });
    await branch(
      organization.id,
      "LATE",
      "ACTIVE",
      new Date("2026-09-29T00:00:00.000Z"),
    );
    let providerCalls = 0;
    const provider: AiProvider = {
      async generate(_input, observer) {
        providerCalls++;
        const attempt = {
          provider: "openrouter" as const,
          requestedModel: "openrouter/free" as const,
          attemptNumber: 1,
          durationMilliseconds: 1,
          actualModel: "example/routed-free-model",
        };
        await observer?.beforeAttempt(attempt);
        await observer?.afterAttempt(attempt);
        return {
          ok: true,
          text: "Sales were zero for the completed period.",
          requestedModel: attempt.requestedModel,
          actualModel: attempt.actualModel,
          attempts: [attempt],
        };
      },
    };
    const run = createAiInsightOrchestrator(
      prisma,
      createAiInsightJob(prisma, provider),
    );
    const first = await run(runAt);
    const second = await run(runAt);
    expect(first.candidateJobs).toBe(8);
    expect(first.succeeded).toBe(8);
    expect(second).toEqual(first);
    expect(providerCalls).toBe(8);
    expect(await prisma.aiInsightReport.count()).toBe(8);
  });
});
