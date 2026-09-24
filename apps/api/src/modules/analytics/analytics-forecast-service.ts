import type { AnalyticsScopeCandidate } from "./analytics-scope.ts";
import type { ForecastRepository } from "./analytics-forecast-repository.ts";

export function createForecastService(repository: ForecastRepository) {
  return {
    read(request: {
      actorUserId: string;
      organizationId: string;
      productId: string;
      scope: AnalyticsScopeCandidate;
    }) {
      return repository.read(request);
    },
  };
}
