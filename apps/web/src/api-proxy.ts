import type { WebEnvironment } from "./environment";

export const API_HEALTH_PATH = "/api/health";

export function getApiHealthRewrite(environment: WebEnvironment) {
  return {
    destination: `${environment.STOCKWISE_API_ORIGIN}/health`,
    source: API_HEALTH_PATH,
  };
}
