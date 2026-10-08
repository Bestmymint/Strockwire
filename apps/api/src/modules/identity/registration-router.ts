import { Router, type Response } from "express";
import { z } from "zod";

import { canonicalEmailSchema, passwordSchema } from "./credential-schemas.ts";
import type { RegistrationLimiter } from "./registration-limiter.ts";
import type { RegistrationService } from "./registration-service.ts";
import {
  attachVerificationDelivery,
  createCrossSiteRequestProtection,
} from "./credential-lifecycle-router.ts";
import { serializeVerificationProofCookie } from "./verification-security.ts";

const REQUEST_ID_HEADER = "X-Request-Id";

export const registrationRequestSchema = z
  .object({
    email: canonicalEmailSchema,
    password: passwordSchema,
  })
  .strict();

function requestId(response: Response): string {
  const value = response.getHeader(REQUEST_ID_HEADER);
  return typeof value === "string" ? value : "unavailable";
}

export function createRegistrationRouter({
  limiter,
  registrationService,
  publicWebOrigin,
}: {
  limiter: RegistrationLimiter;
  registrationService: RegistrationService;
  publicWebOrigin: string;
}): Router {
  const router = Router();

  router.post(
    "/auth/register",
    createCrossSiteRequestProtection(publicWebOrigin, true),
    async (request, response, next) => {
      const parsedRequest = registrationRequestSchema.safeParse(request.body);

      if (!parsedRequest.success) {
        response.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "The request is invalid.",
            requestId: requestId(response),
          },
        });
        return;
      }

      const limit = limiter.consume(parsedRequest.data.email);
      if (!limit.allowed) {
        response.setHeader("Retry-After", limit.retryAfterSeconds.toString());
        response.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many registration attempts. Try again later.",
            requestId: requestId(response),
          },
        });
        return;
      }

      try {
        const result = await registrationService.register(parsedRequest.data);
        response.append(
          "Set-Cookie",
          serializeVerificationProofCookie(result.proof, result.expiresAt),
        );
        attachVerificationDelivery(response, result.delivery);
        response.status(202).json({
          data: {
            nextStep: "verify_email",
            status: "accepted",
            verification: { challengeId: result.challengeId },
          },
          meta: { requestId: requestId(response) },
        });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  return router;
}
