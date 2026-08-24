import { Router } from "express";

import { createApp } from "./app.ts";
import { loadApiEnvironment } from "./environment.ts";
import { createApiLogger } from "./logger.ts";
import { createPrismaAuthenticationRepository } from "./modules/identity/authentication-repository.ts";
import { createLoginLimiter } from "./modules/identity/login-limiter.ts";
import { createLoginRouter } from "./modules/identity/login-router.ts";
import { createLoginService } from "./modules/identity/login-service.ts";
import {
  argon2PasswordHasher,
  argon2PasswordVerifier,
} from "./modules/identity/password-hasher.ts";
import { createRegistrationLimiter } from "./modules/identity/registration-limiter.ts";
import { createPrismaRegistrationRepository } from "./modules/identity/registration-repository.ts";
import { createRegistrationRouter } from "./modules/identity/registration-router.ts";
import { createRegistrationService } from "./modules/identity/registration-service.ts";
import { createSessionConfiguration } from "./modules/identity/session-configuration.ts";
import { secureSessionTokenProvider } from "./modules/identity/session-token.ts";
import { getPrismaClient } from "./prisma/client.ts";
import { createShutdownHandler, startApiServer } from "./server.ts";

const logger = createApiLogger();

async function main(): Promise<void> {
  const environment = loadApiEnvironment();
  const prisma = getPrismaClient(environment);
  const sessionConfiguration = createSessionConfiguration(environment);
  const authenticationRepository = createPrismaAuthenticationRepository(prisma);
  const loginService = createLoginService({
    configuration: sessionConfiguration,
    passwordVerifier: argon2PasswordVerifier,
    repository: authenticationRepository,
    tokenProvider: secureSessionTokenProvider,
  });
  const registrationService = createRegistrationService({
    passwordHasher: argon2PasswordHasher,
    repository: createPrismaRegistrationRepository(prisma),
  });
  const apiRouter = Router();
  apiRouter.use(
    createRegistrationRouter({
      limiter: createRegistrationLimiter(),
      registrationService,
    }),
  );
  apiRouter.use(
    createLoginRouter({
      configuration: sessionConfiguration,
      limiter: createLoginLimiter(),
      loginService,
    }),
  );

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
