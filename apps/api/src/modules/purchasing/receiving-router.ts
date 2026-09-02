import { Router, type RequestHandler, type Response } from "express";

import { getTrustedAuthenticationContext } from "../identity/authentication-context.ts";
import { createCrossSiteRequestProtection } from "../identity/credential-lifecycle-router.ts";
import { idempotencyKeySchema } from "../inventory/inventory-schemas.ts";
import { purchaseOrderParamsSchema } from "./purchase-order-schemas.ts";
import type {
  ReceivingOutcome,
  SafePurchaseReceipt,
} from "./receiving-repository.ts";
import { receivePurchaseOrderRequestSchema } from "./receiving-schemas.ts";
import type { ReceivingService } from "./receiving-service.ts";

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

function publicReceipt(receipt: SafePurchaseReceipt) {
  const { receivedByMembershipId: _internalMembershipId, ...publicFields } =
    receipt;
  void _internalMembershipId;
  return publicFields;
}

function sendReceipt(response: Response, outcome: ReceivingOutcome): void {
  if (outcome.kind === "success" || outcome.kind === "replay") {
    response.status(outcome.kind === "success" ? 201 : 200).json({
      data: { receipt: publicReceipt(outcome.receipt) },
      meta: { requestId: requestId(response) },
    });
    return;
  }
  const mapped = {
    branch_inactive: [409, "BRANCH_INACTIVE", "The branch is inactive."],
    forbidden: [403, "FORBIDDEN", "The operation is not permitted."],
    idempotency_conflict: [
      409,
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used for another request.",
    ],
    invalid_costs: [
      400,
      "VALIDATION_ERROR",
      "The actual unit costs are invalid.",
    ],
    invalid_quantity: [
      409,
      "PURCHASE_ORDER_RECEIPT_INVALID",
      "The purchase order cannot be received as stored.",
    ],
    invalid_transition: [
      409,
      "PURCHASE_ORDER_STATE_CONFLICT",
      "The purchase order cannot transition in its current state.",
    ],
    invalid_vat: [
      400,
      "VALIDATION_ERROR",
      "The Input VAT snapshot is invalid.",
    ],
    not_found: [
      404,
      "PURCHASE_ORDER_NOT_FOUND",
      "The purchase order was not found.",
    ],
    product_inactive: [409, "PRODUCT_INACTIVE", "A product is inactive."],
    reference_conflict: [
      409,
      "RECEIPT_REFERENCE_CONFLICT",
      "The receipt reference could not be allocated.",
    ],
  } as const;
  const [status, code, message] = mapped[outcome.kind];
  error(response, status, code, message);
}

export function createReceivingRouter({
  authenticationMiddleware,
  publicWebOrigin,
  receivingService,
}: {
  authenticationMiddleware: RequestHandler;
  publicWebOrigin: string;
  receivingService: ReceivingService;
}): Router {
  const router = Router();
  const protectMutation = createCrossSiteRequestProtection(publicWebOrigin);

  router.post(
    "/organizations/:organizationId/branches/:branchId/purchase-orders/:purchaseOrderId/receipts",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const actorUserId = actorId(response);
      const params = purchaseOrderParamsSchema.safeParse(request.params);
      const body = receivePurchaseOrderRequestSchema.safeParse(request.body);
      const idempotencyKey = idempotencyKeySchema.safeParse(
        request.get("Idempotency-Key"),
      );
      if (actorUserId === null) {
        return error(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      }
      if (!params.success || !body.success || !idempotencyKey.success) {
        return error(
          response,
          400,
          "VALIDATION_ERROR",
          "The request is invalid.",
        );
      }
      try {
        sendReceipt(
          response,
          await receivingService.receivePurchaseOrder({
            actorUserId,
            actualCosts: body.data.actualCosts,
            idempotencyKey: idempotencyKey.data,
            organizationId: params.data.organizationId,
            purchaseOrderId: params.data.purchaseOrderId,
            vat: body.data.vat,
          }),
        );
      } catch (cause) {
        next(cause);
      }
    },
  );

  return router;
}
