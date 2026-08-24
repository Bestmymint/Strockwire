import { Router, type RequestHandler, type Response } from "express";

import { getTrustedAuthenticationContext } from "../identity/authentication-context.ts";
import { createCrossSiteRequestProtection } from "../identity/credential-lifecycle-router.ts";
import type {
  CategoryListOutcome,
  CategoryOutcome,
  ProductListOutcome,
  ProductOutcome,
} from "./catalog-repository.ts";
import {
  branchContextQuerySchema,
  catalogLifecycleRequestSchema,
  categoryCreateRequestSchema,
  categoryListQuerySchema,
  categoryParamsSchema,
  categoryUpdateRequestSchema,
  organizationCatalogParamsSchema,
  productCreateRequestSchema,
  productListQuerySchema,
  productParamsSchema,
  productUpdateRequestSchema,
} from "./catalog-schemas.ts";
import type { CatalogService } from "./catalog-service.ts";

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

function sharedFailure(response: Response, outcome: { kind: string }): boolean {
  if (outcome.kind === "branch_context_required") {
    error(
      response,
      400,
      "BRANCH_CONTEXT_REQUIRED",
      "An active branch context is required.",
    );
    return true;
  }
  if (outcome.kind === "forbidden") {
    error(response, 403, "FORBIDDEN", "The operation is not permitted.");
    return true;
  }
  return false;
}

function sendCategory(
  response: Response,
  outcome: CategoryOutcome,
  successStatus = 200,
): void {
  if (outcome.kind === "success") {
    response.status(successStatus).json({
      data: { category: outcome.category },
      meta: { requestId: requestId(response) },
    });
    return;
  }
  if (sharedFailure(response, outcome)) return;
  if (outcome.kind === "not_found") {
    error(response, 404, "CATEGORY_NOT_FOUND", "The category was not found.");
    return;
  }
  if (outcome.kind === "stale") {
    error(
      response,
      409,
      "CATEGORY_STALE",
      "The category changed. Refresh and try again.",
    );
    return;
  }
  error(
    response,
    409,
    "CATEGORY_NAME_CONFLICT",
    "The category name is already in use.",
  );
}

function sendProduct(
  response: Response,
  outcome: ProductOutcome,
  successStatus = 200,
): void {
  if (outcome.kind === "success") {
    response.status(successStatus).json({
      data: { product: outcome.product },
      meta: { requestId: requestId(response) },
    });
    return;
  }
  if (sharedFailure(response, outcome)) return;
  switch (outcome.kind) {
    case "not_found":
      error(response, 404, "PRODUCT_NOT_FOUND", "The product was not found.");
      return;
    case "category_not_found":
      error(response, 404, "CATEGORY_NOT_FOUND", "The category was not found.");
      return;
    case "category_inactive":
      error(response, 409, "CATEGORY_INACTIVE", "The category is inactive.");
      return;
    case "stale":
      error(
        response,
        409,
        "PRODUCT_STALE",
        "The product changed. Refresh and try again.",
      );
      return;
    case "sku_conflict":
      error(response, 409, "SKU_CONFLICT", "The SKU is already in use.");
      return;
    case "barcode_conflict":
      error(
        response,
        409,
        "BARCODE_CONFLICT",
        "The barcode is already in use.",
      );
  }
}

function sendCategoryList(
  response: Response,
  outcome: CategoryListOutcome,
): void {
  if (outcome.kind === "success") {
    response.status(200).json({
      data: { categories: outcome.categories },
      meta: {
        nextCursor: outcome.nextCursor,
        requestId: requestId(response),
      },
    });
    return;
  }
  if (sharedFailure(response, outcome)) return;
  error(response, 400, "INVALID_CURSOR", "The cursor is invalid.");
}

function sendProductList(
  response: Response,
  outcome: ProductListOutcome,
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
  if (sharedFailure(response, outcome)) return;
  error(response, 400, "INVALID_CURSOR", "The cursor is invalid.");
}

export function createCatalogRouter({
  authenticationMiddleware,
  catalogService,
  publicWebOrigin,
}: {
  authenticationMiddleware: RequestHandler;
  catalogService: CatalogService;
  publicWebOrigin: string;
}): Router {
  const router = Router();
  const protectMutation = createCrossSiteRequestProtection(publicWebOrigin);

  router.get(
    "/organizations/:organizationId/categories",
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = organizationCatalogParamsSchema.safeParse(request.params);
      const query = categoryListQuerySchema.safeParse(request.query);
      if (id === null) return authenticationRequired(response);
      if (!params.success || !query.success) return invalidRequest(response);
      try {
        sendCategoryList(
          response,
          await catalogService.listCategories({
            actorUserId: id,
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
    "/organizations/:organizationId/categories",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = organizationCatalogParamsSchema.safeParse(request.params);
      const query = branchContextQuerySchema.safeParse(request.query);
      const body = categoryCreateRequestSchema.safeParse(request.body);
      if (id === null) return authenticationRequired(response);
      if (!params.success || !query.success || !body.success) {
        return invalidRequest(response);
      }
      try {
        sendCategory(
          response,
          await catalogService.createCategory({
            actorUserId: id,
            ...(query.data.branchId === undefined
              ? {}
              : { branchId: query.data.branchId }),
            category: body.data,
            organizationId: params.data.organizationId,
          }),
          201,
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.get(
    "/organizations/:organizationId/categories/:categoryId",
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = categoryParamsSchema.safeParse(request.params);
      const query = branchContextQuerySchema.safeParse(request.query);
      if (id === null) return authenticationRequired(response);
      if (!params.success || !query.success) return invalidRequest(response);
      try {
        sendCategory(
          response,
          await catalogService.getCategory({
            actorUserId: id,
            ...(query.data.branchId === undefined
              ? {}
              : { branchId: query.data.branchId }),
            categoryId: params.data.categoryId,
            organizationId: params.data.organizationId,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.patch(
    "/organizations/:organizationId/categories/:categoryId",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = categoryParamsSchema.safeParse(request.params);
      const query = branchContextQuerySchema.safeParse(request.query);
      const body = categoryUpdateRequestSchema.safeParse(request.body);
      if (id === null) return authenticationRequired(response);
      if (!params.success || !query.success || !body.success) {
        return invalidRequest(response);
      }
      try {
        sendCategory(
          response,
          await catalogService.updateCategory({
            actorUserId: id,
            ...(query.data.branchId === undefined
              ? {}
              : { branchId: query.data.branchId }),
            category: body.data,
            categoryId: params.data.categoryId,
            organizationId: params.data.organizationId,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  for (const [command, status] of [
    ["deactivate", "INACTIVE"],
    ["reactivate", "ACTIVE"],
  ] as const) {
    router.post(
      `/organizations/:organizationId/categories/:categoryId/${command}`,
      protectMutation,
      authenticationMiddleware,
      async (request, response, next) => {
        const id = actorId(response);
        const params = categoryParamsSchema.safeParse(request.params);
        const query = branchContextQuerySchema.safeParse(request.query);
        const body = catalogLifecycleRequestSchema.safeParse(request.body);
        if (id === null) return authenticationRequired(response);
        if (!params.success || !query.success || !body.success) {
          return invalidRequest(response);
        }
        try {
          sendCategory(
            response,
            await catalogService.setCategoryLifecycle({
              actorUserId: id,
              ...(query.data.branchId === undefined
                ? {}
                : { branchId: query.data.branchId }),
              categoryId: params.data.categoryId,
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

  router.get(
    "/organizations/:organizationId/products",
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = organizationCatalogParamsSchema.safeParse(request.params);
      const query = productListQuerySchema.safeParse(request.query);
      if (id === null) return authenticationRequired(response);
      if (!params.success || !query.success) return invalidRequest(response);
      try {
        sendProductList(
          response,
          await catalogService.listProducts({
            actorUserId: id,
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
    "/organizations/:organizationId/products",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = organizationCatalogParamsSchema.safeParse(request.params);
      const query = branchContextQuerySchema.safeParse(request.query);
      const body = productCreateRequestSchema.safeParse(request.body);
      if (id === null) return authenticationRequired(response);
      if (!params.success || !query.success || !body.success) {
        return invalidRequest(response);
      }
      try {
        sendProduct(
          response,
          await catalogService.createProduct({
            actorUserId: id,
            ...(query.data.branchId === undefined
              ? {}
              : { branchId: query.data.branchId }),
            organizationId: params.data.organizationId,
            product: body.data,
          }),
          201,
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.get(
    "/organizations/:organizationId/products/:productId",
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = productParamsSchema.safeParse(request.params);
      const query = branchContextQuerySchema.safeParse(request.query);
      if (id === null) return authenticationRequired(response);
      if (!params.success || !query.success) return invalidRequest(response);
      try {
        sendProduct(
          response,
          await catalogService.getProduct({
            actorUserId: id,
            ...(query.data.branchId === undefined
              ? {}
              : { branchId: query.data.branchId }),
            organizationId: params.data.organizationId,
            productId: params.data.productId,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  router.patch(
    "/organizations/:organizationId/products/:productId",
    protectMutation,
    authenticationMiddleware,
    async (request, response, next) => {
      const id = actorId(response);
      const params = productParamsSchema.safeParse(request.params);
      const query = branchContextQuerySchema.safeParse(request.query);
      const body = productUpdateRequestSchema.safeParse(request.body);
      if (id === null) return authenticationRequired(response);
      if (!params.success || !query.success || !body.success) {
        return invalidRequest(response);
      }
      try {
        sendProduct(
          response,
          await catalogService.updateProduct({
            actorUserId: id,
            ...(query.data.branchId === undefined
              ? {}
              : { branchId: query.data.branchId }),
            organizationId: params.data.organizationId,
            product: body.data,
            productId: params.data.productId,
          }),
        );
      } catch (cause: unknown) {
        next(cause);
      }
    },
  );

  for (const [command, status] of [
    ["deactivate", "INACTIVE"],
    ["reactivate", "ACTIVE"],
  ] as const) {
    router.post(
      `/organizations/:organizationId/products/:productId/${command}`,
      protectMutation,
      authenticationMiddleware,
      async (request, response, next) => {
        const id = actorId(response);
        const params = productParamsSchema.safeParse(request.params);
        const query = branchContextQuerySchema.safeParse(request.query);
        const body = catalogLifecycleRequestSchema.safeParse(request.body);
        if (id === null) return authenticationRequired(response);
        if (!params.success || !query.success || !body.success) {
          return invalidRequest(response);
        }
        try {
          sendProduct(
            response,
            await catalogService.setProductLifecycle({
              actorUserId: id,
              ...(query.data.branchId === undefined
                ? {}
                : { branchId: query.data.branchId }),
              expectedUpdatedAt: body.data.expectedUpdatedAt,
              organizationId: params.data.organizationId,
              productId: params.data.productId,
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
