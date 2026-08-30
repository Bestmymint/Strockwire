import { z } from "zod";

const limitSchema = z.preprocess(
  (value) => value ?? "25",
  z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100)),
);

const cursorSchema = z.string().min(1).optional();
const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)))
  .transform((value) => new Date(value));

export const inventoryParamsSchema = z
  .object({
    branchId: z.string().uuid(),
    organizationId: z.string().uuid(),
  })
  .strict();

export const inventoryProductParamsSchema = inventoryParamsSchema
  .extend({ productId: z.string().uuid() })
  .strict();

export const inventoryListQuerySchema = z
  .object({
    categoryId: z
      .union([z.string().uuid(), z.literal("uncategorized")])
      .optional(),
    cursor: cursorSchema,
    limit: limitSchema,
    status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"),
  })
  .strict();

export const inventoryHistoryQuerySchema = z
  .object({
    cursor: cursorSchema,
    limit: limitSchema,
    occurredAfter: instantSchema.optional(),
    occurredBefore: instantSchema.optional(),
    source: z.literal("MANUAL_ADJUSTMENT").optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.occurredAfter === undefined ||
      value.occurredBefore === undefined ||
      value.occurredAfter <= value.occurredBefore,
  );

export type InventoryHistoryQuery = z.infer<typeof inventoryHistoryQuerySchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
