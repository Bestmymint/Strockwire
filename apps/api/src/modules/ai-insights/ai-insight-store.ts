import { randomUUID } from "node:crypto";

import {
  Prisma,
  type AiInsightReport,
  type AnalyticsSnapshot,
  type AnalyticsSnapshotCadence,
  type PrismaClient,
} from "../../generated/prisma/client.ts";
import type {
  AiProviderAttempt,
  AiProviderFailureCategory,
} from "./ai-provider.ts";

export type InsightIdentity = Readonly<{
  organizationId: string;
  scopeKey: string;
  cadence: AnalyticsSnapshotCadence;
  reportingTimezone: string;
  periodStartInclusive: Date;
  periodEndExclusive: Date;
}>;

type Claim = Readonly<{ report: AiInsightReport; token: string }>;
export type ClaimResult =
  | Readonly<{ kind: "claimed"; claim: Claim }>
  | Readonly<{ kind: "observed"; report: AiInsightReport }>;

const CLAIM_MILLISECONDS = 60_000;

export function createPrismaAiInsightStore(prisma: PrismaClient) {
  const find = (identity: InsightIdentity) =>
    prisma.aiInsightReport.findUnique({
      where: {
        organizationId_scopeKey_cadence_reportingTimezone_periodStartInclusive_periodEndExclusive:
          identity,
      },
    });

  async function observeOrReclaim(
    identity: InsightIdentity,
  ): Promise<ClaimResult | null> {
    const report = await find(identity);
    if (report === null) return null;
    if (report.state !== "IN_PROGRESS") return { kind: "observed", report };
    const now = new Date();
    if (report.claimExpiresAt !== null && report.claimExpiresAt > now)
      return { kind: "observed", report };

    // Once an attempt was reserved, external delivery is ambiguous after a crash.
    if (report.attemptCount !== 0) {
      await prisma.aiInsightReport.updateMany({
        where: {
          id: report.id,
          state: "IN_PROGRESS",
          claimToken: report.claimToken,
          claimExpiresAt: { lte: now },
        },
        data: {
          state: "FAILED",
          failureCategory: "INTERRUPTED",
          completedAt: now,
          claimToken: null,
          claimExpiresAt: null,
        },
      });
      return { kind: "observed", report: (await find(identity))! };
    }

    const token = randomUUID();
    const updated = await prisma.aiInsightReport.updateMany({
      where: {
        id: report.id,
        state: "IN_PROGRESS",
        claimToken: report.claimToken,
        claimExpiresAt: { lte: now },
        attemptCount: 0,
      },
      data: {
        claimToken: token,
        claimedAt: now,
        claimExpiresAt: new Date(now.getTime() + CLAIM_MILLISECONDS),
      },
    });
    const current = (await find(identity))!;
    return updated.count === 1
      ? { kind: "claimed", claim: { report: current, token } }
      : { kind: "observed", report: current };
  }

  return {
    observeOrReclaim,
    async claimNew(
      snapshot: AnalyticsSnapshot,
      promptVersion: string,
    ): Promise<ClaimResult> {
      const identity: InsightIdentity = {
        organizationId: snapshot.organizationId,
        scopeKey: snapshot.scopeKey,
        cadence: snapshot.cadence,
        reportingTimezone: snapshot.reportingTimezone,
        periodStartInclusive: snapshot.periodStartInclusive,
        periodEndExclusive: snapshot.periodEndExclusive,
      };
      const now = new Date();
      const token = randomUUID();
      try {
        const report = await prisma.aiInsightReport.create({
          data: {
            ...identity,
            branchId: snapshot.branchId,
            scope: snapshot.scope,
            snapshotId: snapshot.id,
            schemaVersion: snapshot.schemaVersion,
            metricDefinitionVersion: snapshot.metricDefinitionVersion,
            sourceCutoff: snapshot.sourceCutoff,
            promptVersion,
            claimToken: token,
            claimedAt: now,
            claimExpiresAt: new Date(now.getTime() + CLAIM_MILLISECONDS),
          },
        });
        return { kind: "claimed", claim: { report, token } };
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        )
          throw error;
        return (await observeOrReclaim(identity))!;
      }
    },
    async startAttempt(
      claim: Claim,
      attempt: Pick<
        AiProviderAttempt,
        "provider" | "requestedModel" | "attemptNumber"
      >,
    ) {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.aiInsightReport.updateMany({
          where: {
            id: claim.report.id,
            claimToken: claim.token,
            state: "IN_PROGRESS",
            attemptCount: attempt.attemptNumber - 1,
          },
          data: { attemptCount: null },
        });
        if (changed.count !== 1 || attempt.attemptNumber > 3)
          throw new Error("AI insight claim or call budget is unavailable.");
        await tx.aiInsightAttempt.create({
          data: {
            reportId: claim.report.id,
            ordinal: attempt.attemptNumber,
            provider: attempt.provider,
            requestedModel: attempt.requestedModel,
            startedAt: new Date(),
          },
        });
      });
    },
    async finishAttempt(claim: Claim, attempt: AiProviderAttempt) {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.aiInsightReport.updateMany({
          where: {
            id: claim.report.id,
            claimToken: claim.token,
            state: "IN_PROGRESS",
            attemptCount: null,
          },
          data: {
            attemptCount: attempt.attemptNumber,
            provider: attempt.provider,
          },
        });
        if (changed.count !== 1)
          throw new Error("AI insight claim is unavailable.");
        const finished = await tx.aiInsightAttempt.updateMany({
          where: {
            reportId: claim.report.id,
            ordinal: attempt.attemptNumber,
            finishedAt: null,
            provider: attempt.provider,
            requestedModel: attempt.requestedModel,
          },
          data: {
            finishedAt: new Date(),
            ...(attempt.failureCategory === undefined
              ? {}
              : { failureCategory: attempt.failureCategory }),
            ...(attempt.actualModel === undefined
              ? {}
              : { actualModel: attempt.actualModel }),
            ...(attempt.usage?.promptTokens === undefined
              ? {}
              : { promptTokens: BigInt(attempt.usage.promptTokens) }),
            ...(attempt.usage?.completionTokens === undefined
              ? {}
              : { completionTokens: BigInt(attempt.usage.completionTokens) }),
            ...(attempt.usage?.totalTokens === undefined
              ? {}
              : { totalTokens: BigInt(attempt.usage.totalTokens) }),
            ...(attempt.usage?.cost === undefined
              ? {}
              : { cost: attempt.usage.cost }),
          },
        });
        if (finished.count !== 1)
          throw new Error("AI insight attempt is unavailable.");
      });
    },
    async finish(
      claim: Claim,
      result: Readonly<
        | {
            state: "SUCCEEDED";
            attemptCount: number;
            content: string;
            actualModel: string;
          }
        | {
            state: "FAILED";
            attemptCount: number;
            failureCategory: AiProviderFailureCategory | "INTERRUPTED";
          }
      >,
    ) {
      const now = new Date();
      const changed = await prisma.aiInsightReport.updateMany({
        where: {
          id: claim.report.id,
          claimToken: claim.token,
          state: "IN_PROGRESS",
          attemptCount: result.attemptCount,
        },
        data: {
          state: result.state,
          claimToken: null,
          claimExpiresAt: null,
          completedAt: now,
          ...(result.state === "SUCCEEDED"
            ? {
                content: result.content,
                actualModel: result.actualModel,
                generatedAt: now,
              }
            : { failureCategory: result.failureCategory }),
        },
      });
      if (changed.count !== 1)
        throw new Error("AI insight claim is unavailable.");
      return prisma.aiInsightReport.findUniqueOrThrow({
        where: { id: claim.report.id },
      });
    },
  };
}
