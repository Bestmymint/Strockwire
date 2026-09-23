import type {
  AnalyticsContextEngine,
  AnalyticsContextOutcome,
} from "./analytics-context.ts";
import type { AnalyticsGranularity } from "./analytics-period.ts";
import type { AnalyticsScopeCandidate } from "./analytics-scope.ts";
import type {
  AnalyticsBranchPage,
  AnalyticsBranchRepository,
} from "./analytics-branch-repository.ts";
import {
  analyticsPageLimit,
  assertAnalyticsDimensionCursor,
  type AnalyticsDimensionCursorCodec,
} from "./analytics-dimension-cursor.ts";

export type AnalyticsBranchOutcome =
  | Readonly<{ kind: "success"; page: AnalyticsBranchPage }>
  | Readonly<{ kind: "invalid_cursor" }>
  | Exclude<AnalyticsContextOutcome, { kind: "success" }>;

export function createAnalyticsBranchService(input: {
  contextEngine: AnalyticsContextEngine;
  cursorCodec: AnalyticsDimensionCursorCodec;
  repository: AnalyticsBranchRepository;
}) {
  return {
    async read(request: {
      actorUserId: string;
      cursor?: string;
      from: string;
      granularity: AnalyticsGranularity;
      limit?: number;
      organizationId: string;
      scope: AnalyticsScopeCandidate;
      to: string;
    }): Promise<AnalyticsBranchOutcome> {
      const limit = analyticsPageLimit(request.limit);
      let payload;
      try {
        payload =
          request.cursor === undefined
            ? null
            : input.cursorCodec.decode(request.cursor, "branch");
        if (payload?.lastId === null) throw new Error("invalid last branch");
      } catch {
        return { kind: "invalid_cursor" };
      }
      const contextRequest = {
        actorUserId: request.actorUserId,
        analyticsKind: "business" as const,
        from: request.from,
        granularity: request.granularity,
        organizationId: request.organizationId,
        scope: request.scope,
        to: request.to,
      };
      const outcome =
        payload === null
          ? await input.contextEngine.resolve(contextRequest)
          : await input.contextEngine.resolveAtCutoff(
              contextRequest,
              new Date(payload.sourceCutoff),
            );
      if (outcome.kind !== "success") return outcome;
      if (payload !== null) {
        try {
          assertAnalyticsDimensionCursor(payload, outcome.context);
        } catch {
          return { kind: "invalid_cursor" };
        }
      }
      return {
        kind: "success",
        page: await input.repository.read(
          outcome.context,
          limit,
          payload?.lastId ?? null,
        ),
      };
    },
  };
}
