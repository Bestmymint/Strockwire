import pino from "pino";

export interface ApiLogger {
  error(bindings: Record<string, unknown>, message: string): void;
  info(bindings: Record<string, unknown>, message: string): void;
}

export function createApiLogger(): ApiLogger {
  return pino({
    base: { service: "stockwise-api" },
    level: "info",
  });
}
