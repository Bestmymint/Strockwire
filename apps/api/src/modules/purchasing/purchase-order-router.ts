import { Router, type RequestHandler, type Response } from "express";

import { getTrustedAuthenticationContext } from "../identity/authentication-context.ts";
import { createCrossSiteRequestProtection } from "../identity/credential-lifecycle-router.ts";
import type {
  PurchaseOrderListOutcome,
  PurchaseOrderOutcome,
} from "./purchase-order-repository.ts";
import {
  purchaseOrderCollectionParamsSchema,
  purchaseOrderCreateRequestSchema,
  purchaseOrderListQuerySchema,
  purchaseOrderParamsSchema,
  purchaseOrderUpdateRequestSchema,
} from "./purchase-order-schemas.ts";
import type { PurchaseOrderService } from "./purchase-order-service.ts";

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

function sendPurchaseOrder(
  response: Response,
  outcome: PurchaseOrderOutcome,
  status = 200,
): void {
  if (outcome.kind === "success") {
    response.status(status).json({
      data: { purchaseOrder: outcome.purchaseOrder },
      meta: { requestId: requestId(response) },
    });
    return;
  }
  const mapped = {
    branch_inactive: [409, "BRANCH_INACTIVE", "The branch is inactive."],
    duplicate_product: [
      400,
      "DUPLICATE_PRODUCT",
      "Each product may appear only once.",
    ],
    forbidden: [403, "FORBIDDEN", "The operation is not permitted."],
    invalid_cost: [
      400,
      "VALIDATION_ERROR",
      "The expected unit cost is invalid.",
    ],
    invalid_quantity: [400, "VALIDATION_ERROR", "The quantity is invalid."],
    invalid_transition: [
      409,
      "PURCHASE_ORDER_STATE_CONFLICT",
      "The purchase order cannot transition in its current state.",
    ],
    not_found: [
      404,
      "PURCHASE_ORDER_NOT_FOUND",
      "The purchase order was not found.",
    ],
    product_inactive: [409, "PRODUCT_INACTIVE", "A product is inactive."],
    product_not_found: [404, "PRODUCT_NOT_FOUND", "A product was not found."],
    reference_conflict: [
      409,
      "PURCHASE_ORDER_REFERENCE_CONFLICT",
      "The purchase order reference could not be allocated.",
    ],
    stale: [409, "PURCHASE_ORDER_STALE", "The purchase order has changed."],
    supplier_inactive: [409, "SUPPLIER_INACTIVE", "The supplier is inactive."],
    supplier_not_found: [
      404,
      "SUPPLIER_NOT_FOUND",
      "The supplier was not found.",
    ],
  } as const;
  const [statusCode, code, message] = mapped[outcome.kind];
  error(response, statusCode, code, message);
}

function sendList(response: Response, outcome: PurchaseOrderListOutcome): void {
  if (outcome.kind === "success") {
    response.json({
      data: { purchaseOrders: outcome.purchaseOrders },
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

export function createPurchaseOrderRouter({
  authenticationMiddleware,
  publicWebOrigin,
  purchaseOrderService,
}: {
  authenticationMiddleware: RequestHandler;
  publicWebOrigin: string;
  purchaseOrderService: PurchaseOrderService;
}): Router {
  const router = Router();
  const protectMutation = createCrossSiteRequestProtection(publicWebOrigin);

  router.get(
    "/organizations/:organizationId/branches/:branchId/purchase-orders",
    authenticationMiddleware,
    async (request, response, next) => {
      const actorUserId = actorId(response);
      const params = purchaseOrderCollectionParamsSchema.safeParse(
        request.params,
      );
      const query = purchaseOrderListQuerySchema.safeParse(request.query);
      if (actorUserId === null) {
        return error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      }
      if (!params.success || !query.success) {
        return error(
          response,
          400,
          "VALIDATION_ERROR",
          "The request is invalid.",
        );
      }
      try {
        sendList(
          response,
          await purchaseOrderService.listPurchaseOrders({
            actorUserId,
            branchId: params.data.branchId,
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
    "/organizations/:organizationId/branches/:branchId/purchase-orders",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const actorUserId = actorId(response);
      const params = purchaseOrderCollectionParamsSchema.safeParse(
        request.params,
      );
      const body = purchaseOrderCreateRequestSchema.safeParse(request.body);
      if (actorUserId === null) {
        return error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      }
      if (!params.success || !body.success) {
        return error(
          response,
          400,
          "VALIDATION_ERROR",
          "The request is invalid.",
        );
      }
      try {
        sendPurchaseOrder(
          response,
          await purchaseOrderService.createPurchaseOrder({
            actorUserId,
            branchId: params.data.branchId,
            organizationId: params.data.organizationId,
            purchaseOrder: body.data,
          }),
          201,
        );
      } catch (cause) {
        next(cause);
      }
    },
  );

  router.get(
    "/organizations/:organizationId/branches/:branchId/purchase-orders/:purchaseOrderId",
    authenticationMiddleware,
    async (request, response, next) => {
      const actorUserId = actorId(response);
      const params = purchaseOrderParamsSchema.safeParse(request.params);
      if (actorUserId === null) {
        return error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      }
      if (!params.success) {
        return error(
          response,
          400,
          "VALIDATION_ERROR",
          "The request is invalid.",
        );
      }
      try {
        sendPurchaseOrder(
          response,
          await purchaseOrderService.getPurchaseOrder({
            actorUserId,
            ...params.data,
          }),
        );
      } catch (cause) {
        next(cause);
      }
    },
  );

  router.patch(
    "/organizations/:organizationId/branches/:branchId/purchase-orders/:purchaseOrderId",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const actorUserId = actorId(response);
      const params = purchaseOrderParamsSchema.safeParse(request.params);
      const body = purchaseOrderUpdateRequestSchema.safeParse(request.body);
      if (actorUserId === null) {
        return error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      }
      if (!params.success || !body.success) {
        return error(
          response,
          400,
          "VALIDATION_ERROR",
          "The request is invalid.",
        );
      }
      try {
        sendPurchaseOrder(
          response,
          await purchaseOrderService.updatePurchaseOrder({
            actorUserId,
            ...params.data,
            purchaseOrder: body.data,
          }),
        );
      } catch (cause) {
        next(cause);
      }
    },
  );

  return router;
}
