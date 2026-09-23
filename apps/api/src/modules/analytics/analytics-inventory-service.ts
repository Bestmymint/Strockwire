import type {
  AnalyticsContextEngine,
  AnalyticsContextOutcome,
} from "./analytics-context.ts";
import {
  analyticsPageLimit,
  assertAnalyticsDimensionCursor,
  InvalidAnalyticsCursorError,
  type AnalyticsDimensionCursorCodec,
} from "./analytics-dimension-cursor.ts";
import type { AnalyticsGranularity } from "./analytics-period.ts";
import type { AnalyticsScopeCandidate } from "./analytics-scope.ts";
import type {
  AnalyticsInventoryPage,
  AnalyticsInventoryRepository,
} from "./analytics-inventory-repository.ts";

export type AnalyticsInventoryOutcome =
  | Readonly<{ kind: "success"; page: AnalyticsInventoryPage }>
  | Readonly<{ kind: "invalid_cursor" }>
  | Exclude<AnalyticsContextOutcome, { kind: "success" }>;

export function createAnalyticsInventoryService(input: {
  contextEngine: AnalyticsContextEngine;
  cursorCodec: AnalyticsDimensionCursorCodec;
  repository: AnalyticsInventoryRepository;
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
    }): Promise<AnalyticsInventoryOutcome> {
      const limit = analyticsPageLimit(request.limit);
      let payload;
      try {
        payload =
          request.cursor === undefined
            ? null
            : input.cursorCodec.decode(request.cursor, "inventory");
      } catch {
        return { kind: "invalid_cursor" };
      }
      const contextRequest = {
        actorUserId: request.actorUserId,
        analyticsKind: "inventory" as const,
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
      try {
        return {
          kind: "success",
          page: await input.repository.read(
            outcome.context,
            limit,
            payload === null
              ? null
              : {
                  branchId: payload.lastBranchId!,
                  productId: payload.lastProductId!,
                },
            payload !== null,
            request.actorUserId,
            request.scope,
          ),
        };
      } catch (error) {
        if (error instanceof InvalidAnalyticsCursorError)
          return { kind: "invalid_cursor" };
        throw error;
      }
    },
  };
}
