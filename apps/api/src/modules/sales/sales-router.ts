import { Router, type RequestHandler, type Response } from "express";

import { getTrustedAuthenticationContext } from "../identity/authentication-context.ts";
import { createCrossSiteRequestProtection } from "../identity/credential-lifecycle-router.ts";
import { idempotencyKeySchema } from "../inventory/inventory-schemas.ts";
import type { CheckoutOutcome } from "./checkout-repository.ts";
import type { CheckoutService } from "./checkout-service.ts";
import type {
  PosProductSearchOutcome,
  SalesVatProfileOutcome,
  SalesVatProfileUpdateOutcome,
} from "./sales-api-repository.ts";
import type { SalesApiService } from "./sales-api-service.ts";
import {
  branchSalesParamsSchema,
  checkoutRequestSchema,
  organizationSalesParamsSchema,
  posProductSearchQuerySchema,
  salesVatProfileUpdateSchema,
} from "./sales-schemas.ts";

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
  response.status(status).json({
    error: { code, message, requestId: requestId(response) },
  });
}

function actorId(response: Response): string | null {
  return getTrustedAuthenticationContext(response)?.actor.id ?? null;
}

function authenticationRequired(response: Response): void {
  error(
    response,
    401,
    "AUTHENTICATION_REQUIRED",
    "Authentication is required.",
  );
}

function invalidRequest(response: Response): void {
  error(response, 400, "VALIDATION_ERROR", "The request is invalid.");
}

function sendSalesVatProfile(
  response: Response,
  outcome: SalesVatProfileOutcome | SalesVatProfileUpdateOutcome,
): void {
  if (outcome.kind === "success") {
    response.status(200).json({
      data: { salesVatProfile: outcome.profile },
      meta: { requestId: requestId(response) },
    });
    return;
  }
  if (outcome.kind === "forbidden") {
    error(response, 403, "FORBIDDEN", "The operation is not permitted.");
    return;
  }
  if (outcome.kind === "stale") {
    error(
      response,
      409,
      "SALES_VAT_PROFILE_STALE",
      "The sales VAT profile changed. Refresh and try again.",
    );
    return;
  }
  invalidRequest(response);
}

function sendPosProducts(
  response: Response,
  outcome: PosProductSearchOutcome,
): void {
  if (outcome.kind === "success") {
    response.status(200).json({
      data: { products: outcome.products },
      meta: {
        nextCursor: outcome.nextCursor,
        requestId: requestId(response),
      },
    });
    return;
  }
  if (outcome.kind === "forbidden") {
    error(response, 403, "FORBIDDEN", "The operation is not permitted.");
    return;
  }
  if (outcome.kind === "branch_inactive") {
    error(response, 409, "BRANCH_INACTIVE", "The branch is inactive.");
    return;
  }
  error(response, 400, "INVALID_CURSOR", "The cursor is invalid.");
}

function sendCheckout(response: Response, outcome: CheckoutOutcome): void {
  if (outcome.kind === "success" || outcome.kind === "replay") {
    response.status(outcome.kind === "success" ? 201 : 200).json({
      data: { sale: outcome.sale },
      meta: { requestId: requestId(response) },
    });
    return;
  }
  const failures = {
    branch_inactive: [409, "BRANCH_INACTIVE", "The branch is inactive."],
    duplicate_product: [400, "VALIDATION_ERROR", "The request is invalid."],
    forbidden: [403, "FORBIDDEN", "The operation is not permitted."],
    idempotency_conflict: [
      409,
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used for another request.",
    ],
    insufficient_stock: [
      409,
      "INSUFFICIENT_STOCK",
      "There is insufficient stock to complete checkout.",
    ],
    invalid_amounts: [400, "VALIDATION_ERROR", "The request is invalid."],
    invalid_discount: [400, "VALIDATION_ERROR", "The discount is invalid."],
    invalid_idempotency_key: [
      400,
      "VALIDATION_ERROR",
      "The idempotency key is invalid.",
    ],
    invalid_payment: [400, "VALIDATION_ERROR", "The payment is invalid."],
    invalid_price: [400, "VALIDATION_ERROR", "The price is invalid."],
    invalid_quantity: [400, "VALIDATION_ERROR", "The quantity is invalid."],
    not_found: [404, "PRODUCT_NOT_FOUND", "A product was not found."],
    price_changed: [
      409,
      "PRICE_CHANGED",
      "A product price changed. Refresh and try again.",
    ],
    product_inactive: [409, "PRODUCT_INACTIVE", "A product is inactive."],
    vat_configuration_required: [
      409,
      "VAT_CONFIGURATION_REQUIRED",
      "Sales VAT configuration is required before checkout.",
    ],
  } as const;
  const [status, code, message] = failures[outcome.kind];
  error(response, status, code, message);
}

export function createSalesRouter({
  authenticationMiddleware,
  checkoutService,
  publicWebOrigin,
  salesApiService,
}: {
  authenticationMiddleware: RequestHandler;
  checkoutService: CheckoutService;
  publicWebOrigin: string;
  salesApiService: SalesApiService;
}): Router {
  const router = Router();
  const protectMutation = createCrossSiteRequestProtection(publicWebOrigin);

  router.get(
    "/organizations/:organizationId/sales-vat-profile",
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = organizationSalesParamsSchema.safeParse(request.params);
      if (id === null) return authenticationRequired(response);
      if (!params.success) return invalidRequest(response);
      try {
        sendSalesVatProfile(
          response,
          await salesApiService.getSalesVatProfile({
            actorUserId: id,
            organizationId: params.data.organizationId,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.patch(
    "/organizations/:organizationId/sales-vat-profile",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = organizationSalesParamsSchema.safeParse(request.params);
      const body = salesVatProfileUpdateSchema.safeParse(request.body);
      if (id === null) return authenticationRequired(response);
      if (!params.success || !body.success) return invalidRequest(response);
      try {
        sendSalesVatProfile(
          response,
          await salesApiService.updateSalesVatProfile({
            actorUserId: id,
            organizationId: params.data.organizationId,
            profile: body.data,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.get(
    "/organizations/:organizationId/branches/:branchId/pos/products",
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = branchSalesParamsSchema.safeParse(request.params);
      const query = posProductSearchQuerySchema.safeParse(request.query);
      if (id === null) return authenticationRequired(response);
      if (!params.success || !query.success) return invalidRequest(response);
      try {
        sendPosProducts(
          response,
          await salesApiService.searchPosProducts({
            actorUserId: id,
            branchId: params.data.branchId,
            organizationId: params.data.organizationId,
            query: query.data,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.post(
    "/organizations/:organizationId/branches/:branchId/sales",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = branchSalesParamsSchema.safeParse(request.params);
      const body = checkoutRequestSchema.safeParse(request.body);
      const idempotencyKey = idempotencyKeySchema.safeParse(
        request.get("Idempotency-Key"),
      );
      if (id === null) return authenticationRequired(response);
      if (!params.success || !body.success || !idempotencyKey.success) {
        return invalidRequest(response);
      }
      try {
        sendCheckout(
          response,
          await checkoutService.checkout({
            actorUserId: id,
            branchId: params.data.branchId,
            discount: body.data.discount,
            idempotencyKey: idempotencyKey.data,
            items: body.data.items,
            organizationId: params.data.organizationId,
            payment: body.data.payment,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  return router;
}
