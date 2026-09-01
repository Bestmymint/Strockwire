import { z } from "zod";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d{1,4}))?$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const dateSchema = z
  .string()
  .regex(DATE_PATTERN)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  })
  .transform((value) => new Date(`${value}T00:00:00.000Z`));
const expectedUpdatedAtSchema = z
  .string()
  .regex(TIMESTAMP_PATTERN)
  .refine((value) => !Number.isNaN(Date.parse(value)))
  .transform((value) => new Date(value));
const decimalStringSchema = z
  .string()
  .regex(DECIMAL_PATTERN)
  .refine(
    (value) => (value.split(".")[0]?.replace(/^0+/, "") || "0").length <= 15,
  );
const quantityStringSchema = decimalStringSchema.refine(
  (value) => (value.split(".")[0]?.replace(/^0+/, "") || "0").length <= 14,
);
const limitSchema = z.preprocess(
  (value) => value ?? "25",
  z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100)),
);

const itemSchema = z
  .object({
    expectedUnitCost: decimalStringSchema,
    productId: z.string().uuid(),
    quantity: quantityStringSchema,
  })
  .strict();
const itemsSchema = z
  .array(itemSchema)
  .min(1)
  .superRefine((items, context) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.productId)) {
        context.addIssue({
          code: "custom",
          message: "Each product may appear only once.",
          path: [index, "productId"],
        });
      }
      seen.add(item.productId);
    }
  });

export const purchaseOrderCollectionParamsSchema = z
  .object({ organizationId: z.string().uuid(), branchId: z.string().uuid() })
  .strict();
export const purchaseOrderParamsSchema = purchaseOrderCollectionParamsSchema
  .extend({ purchaseOrderId: z.string().uuid() })
  .strict();
export const purchaseOrderCreateRequestSchema = z
  .object({
    expectedDate: dateSchema
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    items: itemsSchema,
    orderDate: dateSchema,
    supplierId: z.string().uuid(),
  })
  .strict();
export const purchaseOrderUpdateRequestSchema = z
  .object({
    branchId: z.string().uuid().optional(),
    expectedDate: dateSchema.nullable().optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
    items: itemsSchema.optional(),
    orderDate: dateSchema.optional(),
    status: z.enum(["ORDERED", "CANCELLED"]).optional(),
    supplierId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasDraftField =
      value.branchId !== undefined ||
      value.expectedDate !== undefined ||
      value.items !== undefined ||
      value.orderDate !== undefined ||
      value.supplierId !== undefined;
    if (value.status !== undefined && hasDraftField) {
      context.addIssue({
        code: "custom",
        message: "A lifecycle transition cannot include DRAFT fields.",
      });
    }
    if (value.status === undefined && !hasDraftField) {
      context.addIssue({
        code: "custom",
        message: "At least one editable field is required.",
      });
    }
  });
export const purchaseOrderListQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: limitSchema,
    orderDateFrom: dateSchema.optional(),
    orderDateTo: dateSchema.optional(),
    status: z
      .enum(["DRAFT", "ORDERED", "RECEIVED", "CANCELLED", "all"])
      .optional()
      .default("all"),
    supplierId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.orderDateFrom !== undefined &&
      value.orderDateTo !== undefined &&
      value.orderDateFrom.getTime() > value.orderDateTo.getTime()
    ) {
      context.addIssue({ code: "custom", message: "Invalid date range." });
    }
  });

export type PurchaseOrderCreateInput = z.infer<
  typeof purchaseOrderCreateRequestSchema
>;
export type PurchaseOrderUpdateInput = z.infer<
  typeof purchaseOrderUpdateRequestSchema
>;
export type PurchaseOrderListInput = z.infer<
  typeof purchaseOrderListQuerySchema
>;
