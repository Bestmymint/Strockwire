import { Router, type Response } from "express";
import { z } from "zod";

import { canonicalEmailSchema, passwordSchema } from "./credential-schemas.ts";
import { isOneTimeToken } from "./one-time-token.ts";
import type { PendingRegistrationService } from "./pending-registration-service.ts";
import {
  attachVerificationDelivery,
  createCrossSiteRequestProtection,
} from "./credential-lifecycle-router.ts";
import {
  serializeClearedVerificationProofCookie,
  serializeVerificationProofCookie,
} from "./verification-security.ts";

const REQUEST_ID_HEADER = "X-Request-Id";
const registerSchema = z
  .object({ email: canonicalEmailSchema, password: passwordSchema })
  .strict();
const emailSchema = z.object({ email: canonicalEmailSchema }).strict();
const codeSchema = z
  .object({
    email: canonicalEmailSchema,
    challengeId: z.uuid(),
    code: z.string().regex(/^[0-9]{6}$/),
  })
  .strict();
const tokenSchema = z
  .object({ token: z.string().refine(isOneTimeToken) })
  .strict();

function requestId(response: Response): string {
  const value = response.getHeader(REQUEST_ID_HEADER);
  return typeof value === "string" ? value : "unavailable";
}

function validationError(response: Response): void {
  response.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "The request is invalid.",
      requestId: requestId(response),
    },
  });
}

function rateLimited(response: Response, retryAfterSeconds: number): void {
  response.setHeader("Retry-After", retryAfterSeconds.toString());
  response.status(429).json({
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Try again later.",
      requestId: requestId(response),
    },
  });
}

function completion(
  response: Response,
  result: "verified" | "already_verified" | "invalid" | "proof_required",
  code: boolean,
): void {
  if (result === "invalid") {
    response.status(400).json({
      error: {
        code: code ? "INVALID_VERIFICATION_CODE" : "INVALID_TOKEN",
        message: code
          ? "The verification code is invalid or expired."
          : "The token is invalid or expired.",
        requestId: requestId(response),
      },
    });
    return;
  }
  if (result === "proof_required") {
    response.status(401).json({
      error: {
        code: "VERIFICATION_PASSWORD_PROOF_REQUIRED",
        message: "Current password proof is required.",
        requestId: requestId(response),
      },
    });
    return;
  }
  if (result === "already_verified") {
    response.status(200).json({
      data: { status: "already_verified" },
      meta: { requestId: requestId(response) },
    });
    return;
  }
  response.append("Set-Cookie", serializeClearedVerificationProofCookie());
  response.status(200).json({
    data: { status: "verified" },
    meta: { requestId: requestId(response) },
  });
}

export function createPendingRegistrationRouter({
  pendingRegistrationService,
  publicWebOrigin,
}: {
  pendingRegistrationService: PendingRegistrationService;
  publicWebOrigin: string;
}): Router {
  const router = Router();
  const protection = createCrossSiteRequestProtection(publicWebOrigin, true);

  router.post("/auth/register", protection, async (request, response, next) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      validationError(response);
      return;
    }
    try {
      const result = await pendingRegistrationService.register(parsed.data);
      if ("outcome" in result) {
        rateLimited(response, result.retryAfterSeconds);
        return;
      }
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
  });

  router.post(
    "/auth/verification-resend",
    protection,
    async (request, response, next) => {
      const parsed = emailSchema.safeParse(request.body);
      if (!parsed.success) {
        validationError(response);
        return;
      }
      try {
        const result = await pendingRegistrationService.resend(
          parsed.data.email,
        );
        if (result.outcome === "limited") {
          rateLimited(response, result.retryAfterSeconds);
          return;
        }
        attachVerificationDelivery(response, result.delivery);
        response.status(202).json({
          data: {
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

  router.post(
    "/auth/verification-password-proof",
    protection,
    async (request, response, next) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        validationError(response);
        return;
      }
      try {
        const result = await pendingRegistrationService.provePassword(
          parsed.data,
        );
        if (result.outcome === "limited") {
          rateLimited(response, result.retryAfterSeconds);
          return;
        }
        if (result.outcome === "invalid") {
          response.status(401).json({
            error: {
              code: "INVALID_CREDENTIALS",
              message: "The email or password is incorrect.",
              requestId: requestId(response),
            },
          });
          return;
        }
        response.append(
          "Set-Cookie",
          serializeVerificationProofCookie(result.proof, result.expiresAt),
        );
        response.status(202).json({
          data: { status: "accepted" },
          meta: { requestId: requestId(response) },
        });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/verify-email-code",
    protection,
    async (request, response, next) => {
      const parsed = codeSchema.safeParse(request.body);
      if (!parsed.success) {
        completion(response, "invalid", true);
        return;
      }
      try {
        completion(
          response,
          await pendingRegistrationService.completeCode({
            ...parsed.data,
            cookieHeader: request.headers.cookie,
          }),
          true,
        );
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/verify-email",
    protection,
    async (request, response, next) => {
      const parsed = tokenSchema.safeParse(request.body);
      if (!parsed.success) {
        completion(response, "invalid", false);
        return;
      }
      try {
        completion(
          response,
          await pendingRegistrationService.completeLink({
            token: parsed.data.token,
            cookieHeader: request.headers.cookie,
          }),
          false,
        );
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  return router;
}
