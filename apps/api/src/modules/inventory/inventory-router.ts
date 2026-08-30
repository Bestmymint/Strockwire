import { Router, type RequestHandler, type Response } from "express";

import { getTrustedAuthenticationContext } from "../identity/authentication-context.ts";
import type {
  InventoryDetailOutcome,
  InventoryHistoryOutcome,
  InventoryListOutcome,
} from "./inventory-repository.ts";
import {
  inventoryHistoryQuerySchema,
  inventoryListQuerySchema,
  inventoryParamsSchema,
  inventoryProductParamsSchema,
} from "./inventory-schemas.ts";
import type { InventoryService } from "./inventory-service.ts";

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

function sendList(response: Response, outcome: InventoryListOutcome): void {
  if (outcome.kind === "success") {
    response.status(200).json({
      data: outcome.inventory,
      meta: { nextCursor: outcome.nextCursor, requestId: requestId(response) },
    });
    return;
  }
  error(
    response,
    outcome.kind === "forbidden" ? 403 : 400,
    outcome.kind === "forbidden" ? "FORBIDDEN" : "INVALID_CURSOR",
    outcome.kind === "forbidden"
      ? "The operation is not permitted."
      : "The cursor is invalid.",
  );
}

function sendDetail(response: Response, outcome: InventoryDetailOutcome): void {
  if (outcome.kind === "success") {
    response.status(200).json({
      data: outcome.inventory,
      meta: { requestId: requestId(response) },
    });
    return;
  }
  error(
    response,
    outcome.kind === "forbidden" ? 403 : 404,
    outcome.kind === "forbidden" ? "FORBIDDEN" : "PRODUCT_NOT_FOUND",
    outcome.kind === "forbidden"
      ? "The operation is not permitted."
      : "The product was not found.",
  );
}

function sendHistory(
  response: Response,
  outcome: InventoryHistoryOutcome,
): void {
  if (outcome.kind === "success") {
    response.status(200).json({
      data: outcome.transactions,
      meta: { nextCursor: outcome.nextCursor, requestId: requestId(response) },
    });
    return;
  }
  const status =
    outcome.kind === "forbidden"
      ? 403
      : outcome.kind === "not_found"
        ? 404
        : 400;
  const code =
    outcome.kind === "forbidden"
      ? "FORBIDDEN"
      : outcome.kind === "not_found"
        ? "PRODUCT_NOT_FOUND"
        : "INVALID_CURSOR";
  const message =
    outcome.kind === "forbidden"
      ? "The operation is not permitted."
      : outcome.kind === "not_found"
        ? "The product was not found."
        : "The cursor is invalid.";
  error(response, status, code, message);
}

export function createInventoryRouter({
  authenticationMiddleware,
  inventoryService,
}: {
  authenticationMiddleware: RequestHandler;
  inventoryService: InventoryService;
}): Router {
  const router = Router();

  router.get(
    "/organizations/:organizationId/branches/:branchId/inventory",
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = inventoryParamsSchema.safeParse(request.params);
      const query = inventoryListQuerySchema.safeParse(request.query);
      if (id === null)
        return error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      if (!params.success || !query.success)
        return error(
          response,
          400,
          "VALIDATION_ERROR",
          "The request is invalid.",
        );
      try {
        sendList(
          response,
          await inventoryService.listBalances({
            actorUserId: id,
            ...params.data,
            query: query.data,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.get(
    "/organizations/:organizationId/branches/:branchId/inventory/:productId",
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = inventoryProductParamsSchema.safeParse(request.params);
      if (id === null)
        return error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      if (!params.success)
        return error(
          response,
          400,
          "VALIDATION_ERROR",
          "The request is invalid.",
        );
      try {
        sendDetail(
          response,
          await inventoryService.getBalance({
            actorUserId: id,
            ...params.data,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.get(
    "/organizations/:organizationId/branches/:branchId/inventory/:productId/transactions",
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = inventoryProductParamsSchema.safeParse(request.params);
      const query = inventoryHistoryQuerySchema.safeParse(request.query);
      if (id === null)
        return error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      if (!params.success || !query.success)
        return error(
          response,
          400,
          "VALIDATION_ERROR",
          "The request is invalid.",
        );
      try {
        sendHistory(
          response,
          await inventoryService.listHistory({
            actorUserId: id,
            ...params.data,
            query: query.data,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  return router;
}
