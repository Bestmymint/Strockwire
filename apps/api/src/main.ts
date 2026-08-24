import { Router } from "express";

import { createApp } from "./app.ts";
import { loadApiEnvironment } from "./environment.ts";
import { createApiLogger } from "./logger.ts";
import { createPrismaAuthenticationRepository } from "./modules/identity/authentication-repository.ts";
import { createPrismaAuthenticationSessionRepository } from "./modules/identity/authentication-repository.ts";
import { createAuthenticationMiddleware } from "./modules/identity/authentication-context.ts";
import { createPrismaCredentialLifecycleRepository } from "./modules/identity/credential-lifecycle-repository.ts";
import { createCredentialLifecycleRouter } from "./modules/identity/credential-lifecycle-router.ts";
import { createCredentialLifecycleService } from "./modules/identity/credential-lifecycle-service.ts";
import { createIdentityEmailProvider } from "./modules/identity/email-provider-configuration.ts";
import { createEmailRequestLimiter } from "./modules/identity/email-request-limiter.ts";
import { createPrismaFirstOrganizationOnboardingRepository } from "./modules/identity/first-organization-onboarding-repository.ts";
import { createFirstOrganizationOnboardingRouter } from "./modules/identity/first-organization-onboarding-router.ts";
import { createFirstOrganizationOnboardingService } from "./modules/identity/first-organization-onboarding-service.ts";
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
import { secureOneTimeTokenProvider } from "./modules/identity/one-time-token.ts";
import { createPrismaBranchRepository } from "./modules/organizations/branch-repository.ts";
import { createBranchRouter } from "./modules/organizations/branch-router.ts";
import { createBranchService } from "./modules/organizations/branch-service.ts";
import { getPrismaClient } from "./prisma/client.ts";
import { createShutdownHandler, startApiServer } from "./server.ts";

const logger = createApiLogger();

async function main(): Promise<void> {
  const environment = loadApiEnvironment();
  const prisma = getPrismaClient(environment);
  const sessionConfiguration = createSessionConfiguration(environment);
  const authenticationRepository = createPrismaAuthenticationRepository(prisma);
  const authenticationSessionRepository =
    createPrismaAuthenticationSessionRepository(prisma);
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
  const credentialLifecycleService = createCredentialLifecycleService({
    emailProvider: createIdentityEmailProvider(environment),
    onDeliveryFailure(kind) {
      logger.error({ deliveryType: kind }, "identity email delivery failed");
    },
    passwordHasher: argon2PasswordHasher,
    publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
    repository: createPrismaCredentialLifecycleRepository(prisma),
    tokenProvider: secureOneTimeTokenProvider,
  });
  const authenticationMiddleware = createAuthenticationMiddleware({
    configuration: sessionConfiguration,
    repository: authenticationSessionRepository,
  });
  const firstOrganizationOnboardingService =
    createFirstOrganizationOnboardingService({
      repository: createPrismaFirstOrganizationOnboardingRepository(prisma),
    });
  const branchService = createBranchService({
    repository: createPrismaBranchRepository(prisma),
  });
  const apiRouter = Router();
  apiRouter.use(
    createRegistrationRouter({
      limiter: createRegistrationLimiter(),
      registrationService,
    }),
  );
  apiRouter.use(
    createCredentialLifecycleRouter({
      authenticationMiddleware,
      configuration: sessionConfiguration,
      lifecycleService: credentialLifecycleService,
      passwordResetLimiter: createEmailRequestLimiter(),
      publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
      verificationResendLimiter: createEmailRequestLimiter(),
    }),
  );
  apiRouter.use(
    createLoginRouter({
      configuration: sessionConfiguration,
      limiter: createLoginLimiter(),
      loginService,
    }),
  );
  apiRouter.use(
    createFirstOrganizationOnboardingRouter({
      authenticationMiddleware,
      onboardingService: firstOrganizationOnboardingService,
      publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
    }),
  );
  apiRouter.use(
    createBranchRouter({
      authenticationMiddleware,
      branchService,
      publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
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
