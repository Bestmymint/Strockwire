import { Router, type Response } from "express";
import { z } from "zod";

import { canonicalEmailSchema, passwordSchema } from "./credential-schemas.ts";
import type { LoginLimiter } from "./login-limiter.ts";
import type { LoginService } from "./login-service.ts";
import type { SessionConfiguration } from "./session-configuration.ts";
import { readSessionCookie, serializeSessionCookie } from "./session-cookie.ts";
import { hashSessionToken } from "./session-token.ts";

const REQUEST_ID_HEADER = "X-Request-Id";

export const loginRequestSchema = z
  .object({
    email: canonicalEmailSchema,
    password: passwordSchema,
  })
  .strict();

function requestId(response: Response): string {
  const value = response.getHeader(REQUEST_ID_HEADER);
  return typeof value === "string" ? value : "unavailable";
}

function invalidCredentials(response: Response): void {
  response.status(401).json({
    error: {
      code: "INVALID_CREDENTIALS",
      message: "The email or password is incorrect.",
      requestId: requestId(response),
    },
  });
}

export function createLoginRouter({
  configuration,
  limiter,
  loginService,
}: {
  configuration: SessionConfiguration;
  limiter: LoginLimiter;
  loginService: LoginService;
}): Router {
  const router = Router();

  router.post("/auth/login", async (request, response, next) => {
    const parsedRequest = loginRequestSchema.safeParse(request.body);

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

    const limit = limiter.check(parsedRequest.data.email);
    if (!limit.allowed) {
      response.setHeader("Retry-After", limit.retryAfterSeconds.toString());
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many login attempts. Try again later.",
          requestId: requestId(response),
        },
      });
      return;
    }

    const existingToken = readSessionCookie(request.headers.cookie);

    try {
      const result = await loginService.login({
        ...parsedRequest.data,
        existingTokenHash:
          existingToken === null ? null : hashSessionToken(existingToken),
      });

      if (result.outcome === "credential_failure") {
        limiter.recordCredentialFailure(parsedRequest.data.email);
        invalidCredentials(response);
        return;
      }

      if (result.outcome === "account_ineligible") {
        invalidCredentials(response);
        return;
      }

      response.setHeader(
        "Set-Cookie",
        serializeSessionCookie(
          result.rawSessionToken,
          configuration.secureCookie,
        ),
      );
      response.status(200).json({
        data: { user: result.user },
        meta: { requestId: requestId(response) },
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
