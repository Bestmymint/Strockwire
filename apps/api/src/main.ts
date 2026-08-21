import { createApp } from "./app.ts";
import { loadApiEnvironment } from "./environment.ts";
import { createApiLogger } from "./logger.ts";
import { createShutdownHandler, startApiServer } from "./server.ts";

const logger = createApiLogger();

async function main(): Promise<void> {
  loadApiEnvironment();

  const app = createApp({ logger });
  const runningServer = await startApiServer(app, {
    host: "127.0.0.1",
    port: 0,
  });
  const shutdown = createShutdownHandler(runningServer, logger);

  logger.info(
    {
      host: runningServer.address.host,
      port: runningServer.address.port,
    },
    "API server started",
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(signal).catch(() => {
        process.exitCode = 1;
      });
    });
  }
}

void main().catch((error: unknown) => {
  logger.error(
    { errorName: error instanceof Error ? error.name : "UnknownError" },
    "API server failed to start",
  );
  process.exitCode = 1;
});
