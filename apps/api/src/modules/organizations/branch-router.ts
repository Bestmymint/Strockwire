import { Router, type RequestHandler, type Response } from "express";

import { getTrustedAuthenticationContext } from "../identity/authentication-context.ts";
import { createCrossSiteRequestProtection } from "../identity/credential-lifecycle-router.ts";
import type { BranchMutationOutcome } from "./branch-repository.ts";
import {
  branchCreateRequestSchema,
  branchIdParamsSchema,
  branchLifecycleRequestSchema,
  branchListQuerySchema,
  branchUpdateRequestSchema,
  organizationIdParamsSchema,
} from "./branch-schemas.ts";
import type { BranchService } from "./branch-service.ts";

const REQUEST_ID_HEADER = "X-Request-Id";

function requestId(response: Response): string {
  const value = response.getHeader(REQUEST_ID_HEADER);
  return typeof value === "string" ? value : "unavailable";
}

function error(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({
    error: { code, message, requestId: requestId(response) },
  });
}

function actorId(response: Response): string | null {
  return getTrustedAuthenticationContext(response)?.actor.id ?? null;
}

function sendMutationOutcome(
  response: Response,
  outcome: BranchMutationOutcome,
  successStatus = 200,
): void {
  switch (outcome.kind) {
    case "success":
      response.status(successStatus).json({
        data: outcome.branch,
        meta: { requestId: requestId(response) },
      });
      return;
    case "forbidden":
      error(response, 403, "FORBIDDEN", "The operation is not permitted.");
      return;
    case "not_found":
      error(response, 404, "BRANCH_NOT_FOUND", "The branch was not found.");
      return;
    case "stale":
      error(
        response,
        409,
        "BRANCH_STALE",
        "The branch changed. Refresh and try again.",
      );
      return;
    case "code_conflict":
      error(
        response,
        409,
        "BRANCH_CODE_CONFLICT",
        "The branch code is already in use.",
      );
      return;
    case "last_active_branch":
      error(
        response,
        409,
        "LAST_ACTIVE_BRANCH",
        "An organization must retain at least one active branch.",
      );
  }
}

export function createBranchRouter({
  authenticationMiddleware,
  branchService,
  publicWebOrigin,
}: {
  authenticationMiddleware: RequestHandler;
  branchService: BranchService;
  publicWebOrigin: string;
}): Router {
  const router = Router();
  const protectMutation = createCrossSiteRequestProtection(publicWebOrigin);

  router.get(
    "/me/access-context",
    authenticationMiddleware,
    async (_request, response, next) => {
      const id = actorId(response);
      if (id === null) {
        error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
        return;
      }

      try {
        const context = await branchService.accessContext(id);
        if (context === null) {
          error(
            response,
            401,
            "AUTHENTICATION_REQUIRED",
            "Authentication is required.",
          );
          return;
        }
        response.status(200).json({
          data: context,
          meta: { requestId: requestId(response) },
        });
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.get(
    "/organizations/:organizationId/branches",
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = organizationIdParamsSchema.safeParse(request.params);
      const query = branchListQuerySchema.safeParse(request.query);
      if (id === null) {
        error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
        return;
      }
      if (!params.success || !query.success) {
        error(response, 400, "VALIDATION_ERROR", "The request is invalid.");
        return;
      }
      try {
        const outcome = await branchService.list(
          id,
          params.data.organizationId,
          query.data.includeInactive,
        );
        if (outcome.kind === "forbidden") {
          error(response, 403, "FORBIDDEN", "The operation is not permitted.");
          return;
        }
        response.status(200).json({
          data: outcome.branches,
          meta: { requestId: requestId(response) },
        });
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.post(
    "/organizations/:organizationId/branches",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = organizationIdParamsSchema.safeParse(request.params);
      const body = branchCreateRequestSchema.safeParse(request.body);
      if (id === null) {
        error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
        return;
      }
      if (!params.success || !body.success) {
        error(response, 400, "VALIDATION_ERROR", "The request is invalid.");
        return;
      }
      try {
        sendMutationOutcome(
          response,
          await branchService.create(id, params.data.organizationId, body.data),
          201,
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.patch(
    "/organizations/:organizationId/branches/:branchId",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = branchIdParamsSchema.safeParse(request.params);
      const body = branchUpdateRequestSchema.safeParse(request.body);
      if (id === null) {
        error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
        return;
      }
      if (!params.success || !body.success) {
        error(response, 400, "VALIDATION_ERROR", "The request is invalid.");
        return;
      }
      try {
        sendMutationOutcome(
          response,
          await branchService.update(
            id,
            params.data.organizationId,
            params.data.branchId,
            body.data,
          ),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  for (const [path, status] of [
    ["deactivate", "INACTIVE"],
    ["reactivate", "ACTIVE"],
  ] as const) {
    router.post(
      `/organizations/:organizationId/branches/:branchId/${path}`,
      protectMutation,
      authenticationMiddleware,
      async (request, response, next) => {
        const id = actorId(response);
        const params = branchIdParamsSchema.safeParse(request.params);
        const body = branchLifecycleRequestSchema.safeParse(request.body);
        if (id === null) {
          error(
            response,
            401,
            "AUTHENTICATION_REQUIRED",
            "Authentication is required.",
          );
          return;
        }
        if (!params.success || !body.success) {
          error(response, 400, "VALIDATION_ERROR", "The request is invalid.");
          return;
        }
        try {
          sendMutationOutcome(
            response,
            await branchService.setLifecycle({
              actorUserId: id,
              branchId: params.data.branchId,
              expectedUpdatedAt: body.data.expectedUpdatedAt,
              organizationId: params.data.organizationId,
              status,
            }),
          );
        } catch (cause: unknown) {
          next(cause);
        }
      },
    );
  }

  return router;
}
