import { z } from "zod";

const receiptItemSchema = z.object({
  actualUnitCost: z.string(),
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productNameSnapshot: z.string(),
  productSkuSnapshot: z.string(),
  purchaseOrderItemId: z.string().uuid(),
  receivedQuantity: z.string(),
});
const receiptSchema = z.object({
  branchId: z.string().uuid(),
  createdAt: z.string(),
  id: z.string().uuid(),
  inputVatAmount: z.string().nullable(),
  inputVatRate: z.string().nullable(),
  items: z.array(receiptItemSchema),
  organizationId: z.string().uuid(),
  organizationVatRegisteredSnapshot: z.boolean(),
  purchaseOrderId: z.string().uuid(),
  receivedAt: z.string(),
  receivedByUserId: z.string().uuid(),
  reference: z.string(),
  supplierId: z.string().uuid(),
  supplierTaxDocumentDate: z.string().nullable(),
  supplierTaxDocumentNumber: z.string().nullable(),
});
const errorSchema = z.object({ error: z.object({ code: z.string() }) });
export type Receipt = z.infer<typeof receiptSchema>;
export interface ReceivingInput {
  actualCosts: Array<{ actualUnitCost: string; purchaseOrderItemId: string }>;
  vat: {
    inputVatAmount: string | null;
    inputVatRate: string | null;
    organizationVatRegistered: boolean;
    supplierTaxDocumentDate: string | null;
    supplierTaxDocumentNumber: string | null;
  };
}
export type ReceivingErrorKind =
  | "authentication_required"
  | "forbidden"
  | "not_found"
  | "branch_inactive"
  | "product_inactive"
  | "state_conflict"
  | "receipt_invalid"
  | "idempotency_conflict"
  | "reference_conflict"
  | "validation"
  | "unavailable";
export class ReceivingApiError extends Error {
  constructor(readonly kind: ReceivingErrorKind) {
    super(kind);
  }
}
export async function receivePurchaseOrder(
  context: { organizationId: string; branchId: string },
  purchaseOrderId: string,
  input: ReceivingInput,
  idempotencyKey: string,
): Promise<Receipt> {
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/organizations/${context.organizationId}/branches/${context.branchId}/purchase-orders/${purchaseOrderId}/receipts`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(input),
      },
    );
  } catch {
    throw new ReceivingApiError("unavailable");
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = z
      .object({ data: z.object({ receipt: receiptSchema }) })
      .safeParse(body);
    if (!parsed.success) throw new ReceivingApiError("unavailable");
    return parsed.data.data.receipt;
  }
  if (response.status === 401)
    throw new ReceivingApiError("authentication_required");
  if (response.status === 403) throw new ReceivingApiError("forbidden");
  const code = errorSchema.safeParse(body).success
    ? (body as { error: { code: string } }).error.code
    : "";
  const map: Record<string, ReceivingErrorKind> = {
    PURCHASE_ORDER_NOT_FOUND: "not_found",
    BRANCH_INACTIVE: "branch_inactive",
    PRODUCT_INACTIVE: "product_inactive",
    PURCHASE_ORDER_STATE_CONFLICT: "state_conflict",
    PURCHASE_ORDER_RECEIPT_INVALID: "receipt_invalid",
    IDEMPOTENCY_CONFLICT: "idempotency_conflict",
    RECEIPT_REFERENCE_CONFLICT: "reference_conflict",
    VALIDATION_ERROR: "validation",
  };
  throw new ReceivingApiError(map[code] ?? "unavailable");
}
