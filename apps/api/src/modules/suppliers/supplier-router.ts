import { Router, type RequestHandler, type Response } from "express";

import { getTrustedAuthenticationContext } from "../identity/authentication-context.ts";
import { createCrossSiteRequestProtection } from "../identity/credential-lifecycle-router.ts";
import type { SupplierListOutcome } from "./supplier-repository.ts";
import {
  supplierCreateRequestSchema,
  supplierListQuerySchema,
  supplierOrganizationParamsSchema,
  supplierParamsSchema,
  supplierUpdateRequestSchema,
} from "./supplier-schemas.ts";
import type { SupplierService } from "./supplier-service.ts";

function requestId(response: Response): string {
  const value = response.getHeader("X-Request-Id");
  return typeof value === "string" ? value : "unavailable";
}
function error(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response
    .status(status)
    .json({ error: { code, message, requestId: requestId(response) } });
}
function actorId(response: Response): string | null {
  return getTrustedAuthenticationContext(response)?.actor.id ?? null;
}
function send(
  response: Response,
  outcome: Awaited<ReturnType<SupplierService["getSupplier"]>>,
  status = 200,
): void {
  if (outcome.kind === "success") {
    response.status(status).json({
      data: { supplier: outcome.supplier },
      meta: { requestId: requestId(response) },
    });
    return;
  }
  error(
    response,
    outcome.kind === "forbidden" ? 403 : 404,
    outcome.kind === "forbidden" ? "FORBIDDEN" : "SUPPLIER_NOT_FOUND",
    outcome.kind === "forbidden"
      ? "The operation is not permitted."
      : "The supplier was not found.",
  );
}
function sendList(response: Response, outcome: SupplierListOutcome): void {
  if (outcome.kind === "success") {
    response.json({
      data: { suppliers: outcome.suppliers },
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

export function createSupplierRouter({
  authenticationMiddleware,
  publicWebOrigin,
  supplierService,
}: {
  authenticationMiddleware: RequestHandler;
  publicWebOrigin: string;
  supplierService: SupplierService;
}): Router {
  const router = Router();
  const protectMutation = createCrossSiteRequestProtection(publicWebOrigin);
  router.get(
    "/organizations/:organizationId/suppliers",
    authenticationMiddleware,
    async (request, response, next) => {
      const actor = actorId(response);
      const params = supplierOrganizationParamsSchema.safeParse(request.params);
      const query = supplierListQuerySchema.safeParse(request.query);
      if (actor === null)
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
          await supplierService.listSuppliers({
            actorUserId: actor,
            organizationId: params.data.organizationId,
            query: query.data,
          }),
        );
      } catch (cause) {
        next(cause);
      }
    },
  );
  router.post(
    "/organizations/:organizationId/suppliers",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const actor = actorId(response);
      const params = supplierOrganizationParamsSchema.safeParse(request.params);
      const body = supplierCreateRequestSchema.safeParse(request.body);
      if (actor === null)
        return error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      if (!params.success || !body.success)
        return error(
          response,
          400,
          "VALIDATION_ERROR",
          "The request is invalid.",
        );
      try {
        send(
          response,
          await supplierService.createSupplier({
            actorUserId: actor,
            organizationId: params.data.organizationId,
            supplier: body.data,
          }),
          201,
        );
      } catch (cause) {
        next(cause);
      }
    },
  );
  router.get(
    "/organizations/:organizationId/suppliers/:supplierId",
    authenticationMiddleware,
    async (request, response, next) => {
      const actor = actorId(response);
      const params = supplierParamsSchema.safeParse(request.params);
      if (actor === null)
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
        send(
          response,
          await supplierService.getSupplier({
            actorUserId: actor,
            ...params.data,
          }),
        );
      } catch (cause) {
        next(cause);
      }
    },
  );
  router.patch(
    "/organizations/:organizationId/suppliers/:supplierId",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const actor = actorId(response);
      const params = supplierParamsSchema.safeParse(request.params);
      const body = supplierUpdateRequestSchema.safeParse(request.body);
      if (actor === null)
        return error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      if (!params.success || !body.success)
        return error(
          response,
          400,
          "VALIDATION_ERROR",
          "The request is invalid.",
        );
      try {
        send(
          response,
          await supplierService.updateSupplier({
            actorUserId: actor,
            ...params.data,
            supplier: body.data,
          }),
        );
      } catch (cause) {
        next(cause);
      }
    },
  );
  for (const [command, status] of [
    ["deactivate", "INACTIVE"],
    ["reactivate", "ACTIVE"],
  ] as const)
    router.post(
      `/organizations/:organizationId/suppliers/:supplierId/${command}`,
      protectMutation,
      authenticationMiddleware,
      async (request, response, next) => {
        const actor = actorId(response);
        const params = supplierParamsSchema.safeParse(request.params);
        if (actor === null)
          return error(
            response,
            401,
            "AUTHENTICATION_REQUIRED",
            "Authentication is required.",
          );
        if (!params.success || Object.keys(request.body ?? {}).length > 0)
          return error(
            response,
            400,
            "VALIDATION_ERROR",
            "The request is invalid.",
          );
        try {
          send(
            response,
            await supplierService.setSupplierLifecycle({
              actorUserId: actor,
              ...params.data,
              status,
            }),
          );
        } catch (cause) {
          next(cause);
        }
      },
    );
  return router;
}
