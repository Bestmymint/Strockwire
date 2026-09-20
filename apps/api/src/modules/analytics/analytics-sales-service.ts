import type {
  AnalyticsContextEngine,
  AnalyticsContextOutcome,
} from "./analytics-context.ts";
import type { AnalyticsGranularity } from "./analytics-period.ts";
import type {
  AnalyticsSalesMetrics,
  AnalyticsSalesRepository,
} from "./analytics-sales-repository.ts";
import type { AnalyticsScopeCandidate } from "./analytics-scope.ts";

export type AnalyticsSalesOutcome =
  | Readonly<{ kind: "success"; metrics: AnalyticsSalesMetrics }>
  | Exclude<AnalyticsContextOutcome, { kind: "success" }>;

export function createAnalyticsSalesService(input: {
  contextEngine: AnalyticsContextEngine;
  repository: AnalyticsSalesRepository;
}) {
  return {
    async read(request: {
      actorUserId: string;
      from: string;
      granularity: AnalyticsGranularity;
      organizationId: string;
      scope: AnalyticsScopeCandidate;
      to: string;
    }): Promise<AnalyticsSalesOutcome> {
      const contextOutcome = await input.contextEngine.resolve({
        ...request,
        analyticsKind: "business",
      });

      if (contextOutcome.kind !== "success") {
        return contextOutcome;
      }

      return {
        kind: "success",
        metrics: await input.repository.read(contextOutcome.context),
      };
    },
  };
}

export type AnalyticsSalesService = ReturnType<
  typeof createAnalyticsSalesService
>;
