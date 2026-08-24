import type { WebEnvironment } from "./environment";

export const API_HEALTH_PATH = "/api/health";
export const API_V1_PATH = "/api/v1/:path*";

export function getApiHealthRewrite(environment: WebEnvironment) {
  return {
    destination: `${environment.STOCKWISE_API_ORIGIN}/health`,
    source: API_HEALTH_PATH,
  };
}

export function getApiV1Rewrite(environment: WebEnvironment) {
  return {
    destination: `${environment.STOCKWISE_API_ORIGIN}/api/v1/:path*`,
    source: API_V1_PATH,
  };
}
