import { Router } from "express";

import { createApp } from "./app.ts";
import { loadApiEnvironment } from "./environment.ts";
import { createApiLogger } from "./logger.ts";
import { createPrismaCatalogRepository } from "./modules/catalog/catalog-repository.ts";
import { createCatalogRouter } from "./modules/catalog/catalog-router.ts";
import { createCatalogService } from "./modules/catalog/catalog-service.ts";
import { createPrismaSupplierRepository } from "./modules/suppliers/supplier-repository.ts";
import { createSupplierRouter } from "./modules/suppliers/supplier-router.ts";
import { createSupplierService } from "./modules/suppliers/supplier-service.ts";
import { createPrismaPurchaseOrderRepository } from "./modules/purchasing/purchase-order-repository.ts";
import { createPurchaseOrderRouter } from "./modules/purchasing/purchase-order-router.ts";
import { createPurchaseOrderService } from "./modules/purchasing/purchase-order-service.ts";
import { createPrismaReceivingRepository } from "./modules/purchasing/receiving-repository.ts";
import { createReceivingRouter } from "./modules/purchasing/receiving-router.ts";
import { createReceivingService } from "./modules/purchasing/receiving-service.ts";
import { createPrismaInventoryRepository } from "./modules/inventory/inventory-repository.ts";
import { createInventoryRouter } from "./modules/inventory/inventory-router.ts";
import { createInventoryService } from "./modules/inventory/inventory-service.ts";
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
import { createMembershipAccessRouter } from "./modules/identity/membership-access-router.ts";
import { createPrismaMembershipAccessRepository } from "./modules/identity/membership-access-repository.ts";
import { createMembershipAccessService } from "./modules/identity/membership-access-service.ts";
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
  const emailProvider = createIdentityEmailProvider(environment);
  const credentialLifecycleService = createCredentialLifecycleService({
    emailProvider,
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
  const membershipAccessService = createMembershipAccessService({
    emailProvider,
    onDeliveryFailure(kind) {
      logger.error({ deliveryType: kind }, "invitation email delivery failed");
    },
    publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
    repository: createPrismaMembershipAccessRepository(prisma),
    tokenProvider: secureOneTimeTokenProvider,
  });
  const catalogService = createCatalogService({
    repository: createPrismaCatalogRepository(prisma),
  });
  const inventoryService = createInventoryService({
    repository: createPrismaInventoryRepository(prisma),
  });
  const supplierService = createSupplierService({
    repository: createPrismaSupplierRepository(prisma),
  });
  const purchaseOrderService = createPurchaseOrderService({
    repository: createPrismaPurchaseOrderRepository(prisma),
  });
  const receivingService = createReceivingService({
    repository: createPrismaReceivingRepository(prisma),
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
  apiRouter.use(
    createMembershipAccessRouter({
      authenticationMiddleware,
      membershipAccessService,
      publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
    }),
  );
  apiRouter.use(
    createCatalogRouter({
      authenticationMiddleware,
      catalogService,
      publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
    }),
  );
  apiRouter.use(
    createSupplierRouter({
      authenticationMiddleware,
      publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
      supplierService,
    }),
  );
  apiRouter.use(
    createPurchaseOrderRouter({
      authenticationMiddleware,
      publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
      purchaseOrderService,
    }),
  );
  apiRouter.use(
    createReceivingRouter({
      authenticationMiddleware,
      publicWebOrigin: environment.STOCKWISE_PUBLIC_WEB_ORIGIN,
      receivingService,
    }),
  );
  apiRouter.use(
    createInventoryRouter({
      authenticationMiddleware,
      inventoryService,
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
