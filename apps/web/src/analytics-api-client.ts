import { z } from "zod";

const nullableMetricSchema = z.object({
  reason: z.string().nullable(),
  value: z.string().nullable(),
});
const metadataSchema = z.object({
  dataStatus: z.string(),
  granularity: z.enum(["day", "week", "month", "year"]),
  includedBranchCount: z.number(),
  localFromInclusive: z.string(),
  localToExclusive: z.string(),
  reportingTimezone: z.string(),
  scopeType: z.enum(["branch", "organization"]),
  sourceCutoff: z.string(),
});
const baseBucketSchema = z.object({
  dataStatus: z.string(),
  discountAmount: z.string(),
  grossSalesAmount: z.string(),
  label: z.string(),
  localEndExclusive: z.string(),
  localStartInclusive: z.string(),
  netSalesAmount: z.string(),
  refundAmount: z.string(),
  salesAfterDiscountAmount: z.string(),
});
const salesBucketSchema = baseBucketSchema.extend({
  averageOrderValue: nullableMetricSchema,
  cost: z
    .object({
      costCoverage: z.enum(["complete", "none", "partial"]),
      grossMarginPercent: nullableMetricSchema,
      grossProfitAmount: nullableMetricSchema,
      knownCostLineCount: z.number(),
      knownNetCogsAmount: z.string(),
      netCogsAmount: nullableMetricSchema,
      refundCogsReversalAmount: z.string(),
      saleCogsAmount: z.string(),
      unknownCostLineCount: z.number(),
    })
    .optional(),
  netOutputVatAmount: z.string(),
  netSalesGrowthPercent: nullableMetricSchema,
  outputVatAmount: z.string(),
  refundCount: z.number(),
  refundedDiscountAmount: z.string(),
  refundedOutputVatAmount: z.string(),
  refundedRegisteredTaxableAmount: nullableMetricSchema,
  refundedSaleCount: z.number(),
  registeredTaxableSalesAmount: nullableMetricSchema,
  saleCount: z.number(),
});
const categoryBucketSchema = baseBucketSchema.extend({
  categorySharePercent: nullableMetricSchema,
});
const salesResponseSchema = z.object({
  data: z.object({ buckets: z.array(salesBucketSchema) }),
  meta: metadataSchema,
});
const categoryResponseSchema = z.object({
  data: z.object({
    categories: z.array(
      z.object({
        buckets: z.array(categoryBucketSchema),
        categoryId: z.string().nullable(),
        categoryKind: z.enum(["CATEGORY", "UNCATEGORIZED"]),
        categoryName: z.string(),
        categoryStatus: z.enum(["ACTIVE", "INACTIVE"]).nullable(),
      }),
    ),
  }),
  meta: metadataSchema.extend({ nextCursor: z.string().nullable() }),
});
const branchResponseSchema = z.object({
  data: z.object({
    branches: z.array(
      z.object({
        branchId: z.string(),
        branchName: z.string(),
        branchStatus: z.enum(["ACTIVE", "INACTIVE"]),
        buckets: z.array(salesBucketSchema),
      }),
    ),
  }),
  meta: metadataSchema.extend({ nextCursor: z.string().nullable() }),
});
const inventoryCostSchema = z.object({
  inventoryValue: nullableMetricSchema,
  knownInventoryValue: z.string(),
  knownCostProductCount: z.number(),
  unknownCostProductCount: z.number(),
  unknownQuantityByUnit: z.record(z.string(), z.string()),
});
const inventoryResponseSchema = z.object({
  data: z.object({
    dimensions: z.array(
      z.object({
        branchId: z.string(),
        branchName: z.string(),
        branchStatus: z.enum(["ACTIVE", "INACTIVE"]),
        productId: z.string(),
        productName: z.string(),
        productStatus: z.enum(["ACTIVE", "INACTIVE"]),
        productUnit: z.string(),
        buckets: z.array(
          z.object({
            label: z.string(),
            localStartInclusive: z.string(),
            localEndExclusive: z.string(),
            dataStatus: z.string(),
            purchaseReceivedQuantity: z.string(),
            saleDepletionQuantity: z.string(),
            refundReturnQuantity: z.string(),
            positiveAdjustmentQuantity: z.string(),
            negativeAdjustmentQuantity: z.string(),
          }),
        ),
        requestedPeriodAds: nullableMetricSchema,
        coverageSalesVelocity: nullableMetricSchema,
        onHandQuantity: z.string(),
        coverageDays: nullableMetricSchema,
        stockClassification: z.object({
          classification: z
            .enum(["LOW_STOCK", "NORMAL", "OVERSTOCK"])
            .nullable(),
          reason: z
            .enum([
              "INSUFFICIENT_DATA",
              "NO_RECENT_DEMAND",
              "NO_STOCK_AND_NO_DEMAND",
              "INVENTORY_INTEGRITY_ERROR",
              "INACTIVE_PRODUCT",
            ])
            .nullable(),
          thresholdVersion: z.literal("stock-risk-v1"),
        }),
        cost: inventoryCostSchema.optional(),
      }),
    ),
    branches: z.array(
      z.object({
        branchId: z.string(),
        branchName: z.string(),
        branchStatus: z.enum(["ACTIVE", "INACTIVE"]),
        activeProductCount: z.number(),
        inStockProductCount: z.number(),
        outOfStockProductCount: z.number(),
        cost: inventoryCostSchema.optional(),
      }),
    ),
  }),
  meta: metadataSchema.extend({
    currentSnapshotCapturedAt: z.string(),
    nextCursor: z.string().nullable(),
  }),
});

export type AnalyticsSalesResponse = z.infer<typeof salesResponseSchema>;
export type AnalyticsCategoryResponse = z.infer<typeof categoryResponseSchema>;
export type AnalyticsBranchResponse = z.infer<typeof branchResponseSchema>;
export type AnalyticsInventoryResponse = z.infer<
  typeof inventoryResponseSchema
>;
export type AnalyticsSalesBucket =
  AnalyticsSalesResponse["data"]["buckets"][number];
export type AnalyticsCategoryBucket =
  AnalyticsCategoryResponse["data"]["categories"][number]["buckets"][number];
export type AnalyticsPeriod = {
  from: string;
  to: string;
  granularity: "day" | "week" | "month" | "year";
};
export type AnalyticsScope =
  { scope: "organization" } | { scope: "branch"; branchId: string };
export type AnalyticsRequest = AnalyticsPeriod &
  AnalyticsScope & {
    organizationId: string;
  };
export type AnalyticsApiErrorKind =
  | "authentication_required"
  | "forbidden"
  | "invalid_cursor"
  | "validation"
  | "configuration"
  | "unavailable";

export class AnalyticsApiError extends Error {
  constructor(readonly kind: AnalyticsApiErrorKind) {
    super(kind);
  }
}

const errorSchema = z.object({ error: z.object({ code: z.string() }) });

function queryString(input: AnalyticsRequest, cursor?: string): string {
  const params = new URLSearchParams({
    from: input.from,
    to: input.to,
    granularity: input.granularity,
    scope: input.scope,
  });
  if (input.scope === "branch") params.set("branchId", input.branchId);
  if (cursor !== undefined) params.set("cursor", cursor);
  return params.toString();
}

async function request<T>(
  dimension: "sales" | "categories" | "branches" | "inventory",
  input: AnalyticsRequest,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  cursor?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/organizations/${input.organizationId}/analytics/${dimension}?${queryString(input, cursor)}`,
      {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        ...(signal ? { signal } : {}),
      },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AnalyticsApiError("unavailable");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AnalyticsApiError("unavailable");
  }
  if (!response.ok) {
    const code = errorSchema.safeParse(body);
    const kind = code.success ? code.data.error.code : "";
    throw new AnalyticsApiError(
      response.status === 401
        ? "authentication_required"
        : kind === "INVALID_CURSOR"
          ? "invalid_cursor"
          : kind === "ANALYTICS_CONFIGURATION_ERROR"
            ? "configuration"
            : response.status === 403
              ? "forbidden"
              : response.status === 400
                ? "validation"
                : "unavailable",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AnalyticsApiError("unavailable");
  return parsed.data;
}

export function getAnalyticsSales(
  input: AnalyticsRequest,
  signal?: AbortSignal,
) {
  return request("sales", input, salesResponseSchema, signal);
}
export function getAnalyticsCategories(
  input: AnalyticsRequest,
  signal?: AbortSignal,
  cursor?: string,
) {
  return request("categories", input, categoryResponseSchema, signal, cursor);
}
export function getAnalyticsBranches(
  input: AnalyticsRequest,
  signal?: AbortSignal,
  cursor?: string,
) {
  return request("branches", input, branchResponseSchema, signal, cursor);
}
export function getAnalyticsInventory(
  input: AnalyticsRequest,
  signal?: AbortSignal,
  cursor?: string,
) {
  return request("inventory", input, inventoryResponseSchema, signal, cursor);
}
