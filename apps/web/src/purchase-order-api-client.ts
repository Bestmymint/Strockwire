import { z } from "zod";

const timestampSchema = z.string().datetime({ offset: false, precision: 3 });
const statusSchema = z.enum(["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"]);
const itemSchema = z.object({
  expectedUnitCost: z.string().regex(/^\d+\.\d{4}$/),
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productNameSnapshot: z.string(),
  productSkuSnapshot: z.string(),
  quantity: z.string().regex(/^\d+(?:\.\d{1,4})?$/),
});
const purchaseOrderSchema = z.object({
  branchId: z.string().uuid(),
  cancelledAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  currency: z.literal("THB"),
  expectedDate: z.string().date().nullable(),
  expectedTotal: z.string().regex(/^\d+\.\d{4}$/),
  id: z.string().uuid(),
  items: z.array(itemSchema),
  orderDate: z.string().date(),
  orderedAt: timestampSchema.nullable(),
  organizationId: z.string().uuid(),
  receivedAt: timestampSchema.nullable(),
  reference: z.string(),
  status: statusSchema,
  supplierId: z.string().uuid(),
  updatedAt: timestampSchema,
});
const summarySchema = purchaseOrderSchema.omit({ items: true });
const responseSchema = z.object({
  data: z.object({ purchaseOrder: purchaseOrderSchema }),
});
const listSchema = z.object({
  data: z.object({ purchaseOrders: z.array(summarySchema) }),
  meta: z.object({ nextCursor: z.string().nullable() }),
});
const errorSchema = z.object({ error: z.object({ code: z.string() }) });

export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderSummary = z.infer<typeof summarySchema>;
export type PurchaseOrderStatus = z.infer<typeof statusSchema>;
export interface PurchaseOrderRequestContext {
  branchId: string;
  organizationId: string;
}
export interface PurchaseOrderInput {
  expectedDate: string | null;
  items: Array<{
    expectedUnitCost: string;
    productId: string;
    quantity: string;
  }>;
  orderDate: string;
  supplierId: string;
}
export type PurchaseOrderApiErrorKind =
  | "authentication_required"
  | "branch_inactive"
  | "forbidden"
  | "invalid_cursor"
  | "not_found"
  | "product_inactive"
  | "product_not_found"
  | "stale"
  | "state_conflict"
  | "supplier_inactive"
  | "supplier_not_found"
  | "unavailable"
  | "validation";

export class PurchaseOrderApiError extends Error {
  constructor(readonly kind: PurchaseOrderApiErrorKind) {
    super(kind);
  }
}

function query(
  values: Record<string, string | number | null | undefined>,
): string {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") {
      result.set(key, String(value));
    }
  }
  const encoded = result.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function path(context: PurchaseOrderRequestContext, purchaseOrderId?: string) {
  const root = `organizations/${context.organizationId}/branches/${context.branchId}/purchase-orders`;
  return purchaseOrderId === undefined ? root : `${root}/${purchaseOrderId}`;
}

async function request(pathname: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${pathname}`, {
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init?.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...init,
    });
  } catch {
    throw new PurchaseOrderApiError("unavailable");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PurchaseOrderApiError("unavailable");
  }
  if (response.ok) return body;

  const parsed = errorSchema.safeParse(body);
  if (response.status === 401)
    throw new PurchaseOrderApiError("authentication_required");
  if (response.status === 403) throw new PurchaseOrderApiError("forbidden");
  const kinds: Record<string, PurchaseOrderApiErrorKind> = {
    BRANCH_INACTIVE: "branch_inactive",
    INVALID_CURSOR: "invalid_cursor",
    PRODUCT_INACTIVE: "product_inactive",
    PRODUCT_NOT_FOUND: "product_not_found",
    PURCHASE_ORDER_NOT_FOUND: "not_found",
    PURCHASE_ORDER_STALE: "stale",
    PURCHASE_ORDER_STATE_CONFLICT: "state_conflict",
    SUPPLIER_INACTIVE: "supplier_inactive",
    SUPPLIER_NOT_FOUND: "supplier_not_found",
    VALIDATION_ERROR: "validation",
  };
  throw new PurchaseOrderApiError(
    parsed.success
      ? (kinds[parsed.data.error.code] ?? "unavailable")
      : "unavailable",
  );
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new PurchaseOrderApiError("unavailable");
  return parsed.data;
}

export function purchaseOrderScopeKey(context: PurchaseOrderRequestContext) {
  return [
    "branch-scoped",
    context.organizationId,
    context.branchId,
    "purchase-orders",
  ] as const;
}

export async function listPurchaseOrders(
  context: PurchaseOrderRequestContext,
  options: {
    cursor?: string | null;
    limit?: number;
    orderDateFrom?: string;
    orderDateTo?: string;
    status?: PurchaseOrderStatus | "all";
    supplierId?: string;
  } = {},
) {
  return parse(
    listSchema,
    await request(
      `${path(context)}${query({
        cursor: options.cursor,
        limit: options.limit,
        orderDateFrom: options.orderDateFrom,
        orderDateTo: options.orderDateTo,
        status: options.status,
        supplierId: options.supplierId,
      })}`,
    ),
  );
}

export async function getPurchaseOrder(
  context: PurchaseOrderRequestContext,
  purchaseOrderId: string,
): Promise<PurchaseOrder> {
  return parse(responseSchema, await request(path(context, purchaseOrderId)))
    .data.purchaseOrder;
}

export async function createPurchaseOrder(
  context: PurchaseOrderRequestContext,
  input: PurchaseOrderInput,
): Promise<PurchaseOrder> {
  return parse(
    responseSchema,
    await request(path(context), {
      body: JSON.stringify(input),
      method: "POST",
    }),
  ).data.purchaseOrder;
}

export async function updatePurchaseOrder(
  context: PurchaseOrderRequestContext,
  purchaseOrderId: string,
  input: Partial<PurchaseOrderInput> & {
    expectedUpdatedAt: string;
    status?: "ORDERED" | "CANCELLED";
  },
): Promise<PurchaseOrder> {
  return parse(
    responseSchema,
    await request(path(context, purchaseOrderId), {
      body: JSON.stringify(input),
      method: "PATCH",
    }),
  ).data.purchaseOrder;
}

export async function transitionPurchaseOrder(
  context: PurchaseOrderRequestContext,
  purchaseOrder: Pick<PurchaseOrder, "id" | "updatedAt">,
  status: "ORDERED" | "CANCELLED",
): Promise<PurchaseOrder> {
  return updatePurchaseOrder(context, purchaseOrder.id, {
    expectedUpdatedAt: purchaseOrder.updatedAt,
    status,
  });
}
