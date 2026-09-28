import type { PrismaClient } from "../../generated/prisma/client.ts";
import { createAnalyticsSnapshotService } from "../analytics/analytics-snapshot-service.ts";
import type { AnalyticsGranularity } from "../analytics/analytics-period.ts";
import type { AnalyticsScopeCandidate } from "../analytics/analytics-scope.ts";
import type { AiProvider } from "./ai-provider.ts";
import {
  createPrismaAiInsightStore,
  type InsightIdentity,
} from "./ai-insight-store.ts";
import {
  AI_SUMMARY_PROMPT_VERSION,
  prepareAiSummaryPrompt,
  validateAiSummaryProse,
} from "./ai-summary-prompt.ts";

const cadence = {
  day: "DAILY",
  week: "WEEKLY",
  month: "MONTHLY",
  year: "YEARLY",
} as const;

export type AiInsightJobInput = Readonly<{
  organizationId: string;
  scope: AnalyticsScopeCandidate;
  from: string;
  to: string;
  granularity: AnalyticsGranularity;
  reportingTimezone: string;
  periodStartInclusive: Date;
  periodEndExclusive: Date;
}>;

export function createAiInsightJob(prisma: PrismaClient, provider: AiProvider) {
  const snapshots = createAnalyticsSnapshotService(prisma);
  const store = createPrismaAiInsightStore(prisma);

  return async function run(input: AiInsightJobInput) {
    const identity: InsightIdentity = {
      organizationId: input.organizationId,
      scopeKey:
        input.scope.kind === "organization"
          ? "organization"
          : input.scope.branchId,
      cadence: cadence[input.granularity],
      reportingTimezone: input.reportingTimezone,
      periodStartInclusive: input.periodStartInclusive,
      periodEndExclusive: input.periodEndExclusive,
    };
    let result = await store.observeOrReclaim(identity);
    if (result === null) {
      const snapshot = await snapshots.create(input);
      if (
        snapshot.scopeKey !== identity.scopeKey ||
        snapshot.cadence !== identity.cadence ||
        snapshot.reportingTimezone !== identity.reportingTimezone ||
        snapshot.periodStartInclusive.getTime() !==
          identity.periodStartInclusive.getTime() ||
        snapshot.periodEndExclusive.getTime() !==
          identity.periodEndExclusive.getTime()
      )
        throw new Error(
          "AI insight scope and completed period do not match the snapshot.",
        );
      result = await store.claimNew(snapshot, AI_SUMMARY_PROMPT_VERSION);
    }
    if (result.kind === "observed") return result.report;
    const { claim } = result;

    if (claim.report.promptVersion !== AI_SUMMARY_PROMPT_VERSION) {
      return store.finish(claim, {
        state: "FAILED",
        attemptCount: 0,
        failureCategory: "INVALID_REQUEST",
      });
    }
    let prompt: ReturnType<typeof prepareAiSummaryPrompt>;
    try {
      const snapshot = await snapshots.findById(
        input.organizationId,
        claim.report.snapshotId,
      );
      if (
        snapshot === null ||
        snapshot.organizationId !== claim.report.organizationId ||
        snapshot.scope !== claim.report.scope ||
        snapshot.scopeKey !== claim.report.scopeKey ||
        snapshot.branchId !== claim.report.branchId ||
        snapshot.cadence !== claim.report.cadence ||
        snapshot.reportingTimezone !== claim.report.reportingTimezone ||
        snapshot.periodStartInclusive.getTime() !==
          claim.report.periodStartInclusive.getTime() ||
        snapshot.periodEndExclusive.getTime() !==
          claim.report.periodEndExclusive.getTime() ||
        snapshot.schemaVersion !== claim.report.schemaVersion ||
        snapshot.metricDefinitionVersion !==
          claim.report.metricDefinitionVersion ||
        snapshot.sourceCutoff.getTime() !== claim.report.sourceCutoff.getTime()
      )
        throw new Error("Pinned analytics snapshot is unavailable.");
      prompt = prepareAiSummaryPrompt(snapshot);
      if (prompt.promptVersion !== claim.report.promptVersion)
        throw new Error("Pinned AI prompt is unavailable.");
    } catch {
      return store.finish(claim, {
        state: "FAILED",
        attemptCount: 0,
        failureCategory: "INVALID_REQUEST",
      });
    }

    // The observer commits each reservation before HTTP and each known result before retry.
    // An uncompleted reservation stays ambiguous after a crash and is never retried.
    let response;
    try {
      response = await provider.generate(
        { text: prompt.text },
        {
          beforeAttempt: (attempt) => store.startAttempt(claim, attempt),
          afterAttempt: (attempt) => store.finishAttempt(claim, attempt),
        },
      );
    } catch {
      // A provider/DB interruption may follow an external call; keep the claim
      // ambiguous until recovery marks it failed without another provider call.
      throw new Error("AI insight execution interrupted.");
    }
    const attemptCount = response.attempts.length;
    if (!response.ok) {
      return store.finish(claim, {
        state: "FAILED",
        attemptCount,
        failureCategory: response.failureCategory,
      });
    }
    let content: string;
    try {
      content = validateAiSummaryProse(response.text);
    } catch {
      return store.finish(claim, {
        state: "FAILED",
        attemptCount,
        failureCategory: "INVALID_RESPONSE",
      });
    }
    return store.finish(claim, {
      state: "SUCCEEDED",
      attemptCount,
      content,
      actualModel: response.actualModel,
    });
  };
}
