import { createApp } from "./app.ts";
import { loadApiEnvironment } from "./environment.ts";
import { createApiLogger } from "./logger.ts";
import { argon2PasswordHasher } from "./modules/identity/password-hasher.ts";
import { createRegistrationLimiter } from "./modules/identity/registration-limiter.ts";
import { createPrismaRegistrationRepository } from "./modules/identity/registration-repository.ts";
import { createRegistrationRouter } from "./modules/identity/registration-router.ts";
import { createRegistrationService } from "./modules/identity/registration-service.ts";
import { getPrismaClient } from "./prisma/client.ts";
import { createShutdownHandler, startApiServer } from "./server.ts";

const logger = createApiLogger();

async function main(): Promise<void> {
  const environment = loadApiEnvironment();
  const prisma = getPrismaClient(environment);
  const registrationService = createRegistrationService({
    passwordHasher: argon2PasswordHasher,
    repository: createPrismaRegistrationRepository(prisma),
  });
  const apiRouter = createRegistrationRouter({
    limiter: createRegistrationLimiter(),
    registrationService,
  });

  const app = createApp({ apiRouter, logger });
  const runningServer = await startApiServer(app, {
    host: "127.0.0.1",
    port: environment.STOCKWISE_API_PORT,
  });
  const shutdown = createShutdownHandler(runningServer, logger, () =>
    prisma.$disconnect(),
  );

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
