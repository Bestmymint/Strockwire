import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";

import { getTrustedAuthenticationContext } from "./authentication-context.ts";
import { canonicalEmailSchema, passwordSchema } from "./credential-schemas.ts";
import type { CredentialLifecycleService } from "./credential-lifecycle-service.ts";
import type { EmailRequestLimiter } from "./email-request-limiter.ts";
import { isOneTimeToken } from "./one-time-token.ts";
import type { SessionConfiguration } from "./session-configuration.ts";
import {
  readSessionCookie,
  serializeClearedSessionCookie,
} from "./session-cookie.ts";
import { hashSessionToken } from "./session-token.ts";

const REQUEST_ID_HEADER = "X-Request-Id";

const emailRequestSchema = z.object({ email: canonicalEmailSchema }).strict();
const tokenSchema = z.string().refine(isOneTimeToken);
const tokenRequestSchema = z.object({ token: tokenSchema }).strict();
const resetPasswordRequestSchema = z
  .object({ newPassword: passwordSchema, token: tokenSchema })
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

function invalidToken(response: Response): void {
  response.status(400).json({
    error: {
      code: "INVALID_TOKEN",
      message: "The token is invalid or expired.",
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

function accepted(response: Response): void {
  response.status(202).json({
    data: { status: "accepted" },
    meta: { requestId: requestId(response) },
  });
}

function createCrossSiteRequestProtection(
  publicWebOrigin: string,
): RequestHandler {
  return (request, response, next) => {
    const fetchSite = request.get("Sec-Fetch-Site");
    const origin = request.get("Origin");
    let originMatches = true;

    if (origin !== undefined) {
      try {
        originMatches = new URL(origin).origin === publicWebOrigin;
      } catch {
        originMatches = false;
      }
    }

    if (fetchSite === "cross-site" || !originMatches) {
      response.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "The request is not allowed.",
          requestId: requestId(response),
        },
      });
      return;
    }

    next();
  };
}

export function createCredentialLifecycleRouter({
  authenticationMiddleware,
  configuration,
  lifecycleService,
  passwordResetLimiter,
  publicWebOrigin,
  verificationResendLimiter,
}: {
  authenticationMiddleware: RequestHandler;
  configuration: SessionConfiguration;
  lifecycleService: CredentialLifecycleService;
  passwordResetLimiter: EmailRequestLimiter;
  publicWebOrigin: string;
  verificationResendLimiter: EmailRequestLimiter;
}): Router {
  const router = Router();
  const crossSiteRequestProtection =
    createCrossSiteRequestProtection(publicWebOrigin);

  router.post(
    "/auth/logout",
    crossSiteRequestProtection,
    async (request, response, next) => {
      const rawToken = readSessionCookie(request.headers.cookie);

      try {
        if (rawToken !== null) {
          await lifecycleService.logoutCurrent(hashSessionToken(rawToken));
        }
        response.setHeader(
          "Set-Cookie",
          serializeClearedSessionCookie(configuration.secureCookie),
        );
        response.status(204).end();
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/logout-all",
    crossSiteRequestProtection,
    authenticationMiddleware,
    async (_request, response, next) => {
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

      try {
        await lifecycleService.logoutAll(context.actor.id);
        response.setHeader(
          "Set-Cookie",
          serializeClearedSessionCookie(configuration.secureCookie),
        );
        response.status(204).end();
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  router.post("/auth/verification-resend", async (request, response, next) => {
    const parsed = emailRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      validationError(response);
      return;
    }

    const limit = verificationResendLimiter.consume(parsed.data.email);
    if (!limit.allowed) {
      rateLimited(response, limit.retryAfterSeconds);
      return;
    }

    try {
      await lifecycleService.requestVerification(parsed.data.email);
      accepted(response);
    } catch (error: unknown) {
      next(error);
    }
  });

  router.post("/auth/verify-email", async (request, response, next) => {
    const parsed = tokenRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      invalidToken(response);
      return;
    }

    try {
      if (!(await lifecycleService.verifyEmail(parsed.data.token))) {
        invalidToken(response);
        return;
      }

      response.status(200).json({
        data: { status: "verified" },
        meta: { requestId: requestId(response) },
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  router.post("/auth/forgot-password", async (request, response, next) => {
    const parsed = emailRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      validationError(response);
      return;
    }

    const limit = passwordResetLimiter.consume(parsed.data.email);
    if (!limit.allowed) {
      rateLimited(response, limit.retryAfterSeconds);
      return;
    }

    try {
      await lifecycleService.requestPasswordReset(parsed.data.email);
      accepted(response);
    } catch (error: unknown) {
      next(error);
    }
  });

  router.post("/auth/reset-password", async (request, response, next) => {
    const parsed = resetPasswordRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      validationError(response);
      return;
    }

    try {
      const reset = await lifecycleService.resetPassword({
        newPassword: parsed.data.newPassword,
        rawToken: parsed.data.token,
      });
      if (!reset) {
        invalidToken(response);
        return;
      }

      response.status(200).json({
        data: { status: "password_reset" },
        meta: { requestId: requestId(response) },
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
