import type { ApiEnvironment } from "../../environment.ts";

const MILLISECONDS_PER_MINUTE = 60 * 1000;

export interface SessionConfiguration {
  absoluteTimeoutMilliseconds: number;
  idleTimeoutMilliseconds: number;
  secureCookie: boolean;
  touchIntervalMilliseconds: number;
}

export function createSessionConfiguration(
  environment: Pick<
    ApiEnvironment,
    | "STOCKWISE_RUNTIME_ENV"
    | "STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES"
    | "STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES"
    | "STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES"
  >,
): SessionConfiguration {
  return {
    absoluteTimeoutMilliseconds:
      environment.STOCKWISE_SESSION_ABSOLUTE_TIMEOUT_MINUTES *
      MILLISECONDS_PER_MINUTE,
    idleTimeoutMilliseconds:
      environment.STOCKWISE_SESSION_IDLE_TIMEOUT_MINUTES *
      MILLISECONDS_PER_MINUTE,
    secureCookie: environment.STOCKWISE_RUNTIME_ENV === "production",
    touchIntervalMilliseconds:
      environment.STOCKWISE_SESSION_TOUCH_INTERVAL_MINUTES *
      MILLISECONDS_PER_MINUTE,
  };
}
