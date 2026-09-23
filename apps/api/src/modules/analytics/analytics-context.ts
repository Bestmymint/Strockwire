import {
  captureAnalyticsSourceCutoff,
  createAnalyticsPeriodContext,
  type AnalyticsGranularity,
  type AnalyticsPeriodContext,
} from "./analytics-period.ts";
import type {
  AnalyticsKind,
  AnalyticsScopeCandidate,
  AuthorizedAnalyticsScope,
} from "./analytics-scope.ts";
import type {
  AnalyticsScopeRepository,
  AnalyticsScopeRepositoryOutcome,
} from "./analytics-scope-repository.ts";

export interface AnalyticsExecutionContext {
  period: AnalyticsPeriodContext;
  scope: AuthorizedAnalyticsScope;
}

export type AnalyticsContextOutcome =
  | Readonly<{ context: AnalyticsExecutionContext; kind: "success" }>
  | Exclude<AnalyticsScopeRepositoryOutcome, { kind: "success" }>;

interface AnalyticsContextRequest {
  actorUserId: string;
  analyticsKind: AnalyticsKind;
  from: string;
  granularity: AnalyticsGranularity;
  organizationId: string;
  scope: AnalyticsScopeCandidate;
  to: string;
}

export function createAnalyticsContextEngine(input: {
  now?: () => Date;
  scopeRepository: AnalyticsScopeRepository;
}) {
  async function resolveContext(
    request: AnalyticsContextRequest,
    sourceCutoffOverride?: Date,
  ): Promise<AnalyticsContextOutcome> {
    // Later metric repositories must execute their reads in one consistent
    // transaction and apply this same cutoff; this foundation captures it once.
    const sourceCutoff = captureAnalyticsSourceCutoff(
      sourceCutoffOverride === undefined
        ? input.now
        : () => sourceCutoffOverride,
    );
    const scopeOutcome = await input.scopeRepository.resolve({
      actorUserId: request.actorUserId,
      analyticsKind: request.analyticsKind,
      candidate: request.scope,
      organizationId: request.organizationId,
    });

    if (scopeOutcome.kind !== "success") {
      return scopeOutcome;
    }

    return {
      context: {
        period: createAnalyticsPeriodContext({
          from: request.from,
          granularity: request.granularity,
          reportingTimezone: scopeOutcome.reportingTimezone,
          sourceCutoff,
          to: request.to,
        }),
        scope: scopeOutcome.scope,
      },
      kind: "success",
    };
  }

  return {
    resolve(
      request: AnalyticsContextRequest,
    ): Promise<AnalyticsContextOutcome> {
      return resolveContext(request);
    },
    resolveAtCutoff(
      request: AnalyticsContextRequest,
      sourceCutoff: Date,
    ): Promise<AnalyticsContextOutcome> {
      return resolveContext(request, sourceCutoff);
    },
  };
}

export type AnalyticsContextEngine = ReturnType<
  typeof createAnalyticsContextEngine
>;
