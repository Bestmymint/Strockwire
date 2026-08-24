import { Router, type RequestHandler, type Response } from "express";

import { getTrustedAuthenticationContext } from "./authentication-context.ts";
import { createCrossSiteRequestProtection } from "./credential-lifecycle-router.ts";
import { firstOrganizationOnboardingRequestSchema } from "./first-organization-onboarding-schema.ts";
import type { FirstOrganizationOnboardingService } from "./first-organization-onboarding-service.ts";

const REQUEST_ID_HEADER = "X-Request-Id";

function requestId(response: Response): string {
  const value = response.getHeader(REQUEST_ID_HEADER);
  return typeof value === "string" ? value : "unavailable";
}

function conflict(
  response: Response,
  code: "ALREADY_ONBOARDED" | "ALREADY_HAS_ORGANIZATION_ACCESS",
): void {
  response.status(409).json({
    error: {
      code,
      message: "First organization onboarding is no longer available.",
      requestId: requestId(response),
    },
  });
}

export function createFirstOrganizationOnboardingRouter({
  authenticationMiddleware,
  onboardingService,
  publicWebOrigin,
}: {
  authenticationMiddleware: RequestHandler;
  onboardingService: FirstOrganizationOnboardingService;
  publicWebOrigin: string;
}): Router {
  const router = Router();

  router.post(
    "/organizations",
    createCrossSiteRequestProtection(publicWebOrigin),
    authenticationMiddleware,
    async (request, response, next) => {
      const context = getTrustedAuthenticationContext(response);
      if (context === null) {
        response.status(401).json({
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "Authentication is required.",
            requestId: requestId(response),
          },
        });
        return;
      }

      const parsed = firstOrganizationOnboardingRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        response.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "The request is invalid.",
            requestId: requestId(response),
          },
        });
        return;
      }

      try {
        const outcome = await onboardingService.complete(
          context.actor.id,
          parsed.data,
        );
        if (outcome.kind === "already_onboarded") {
          conflict(response, "ALREADY_ONBOARDED");
          return;
        }
        if (outcome.kind === "already_has_organization_access") {
          conflict(response, "ALREADY_HAS_ORGANIZATION_ACCESS");
          return;
        }

        response.status(200).json({
          data: outcome.result,
          meta: { requestId: requestId(response) },
        });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  return router;
}
