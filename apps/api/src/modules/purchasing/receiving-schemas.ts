import { z } from "zod";

const actualCostSchema = z
  .object({
    actualUnitCost: z.string(),
    purchaseOrderItemId: z.string().uuid(),
  })
  .strict();

const vatSchema = z
  .object({
    inputVatAmount: z.string().nullable(),
    inputVatRate: z.string().nullable(),
    organizationVatRegistered: z.boolean(),
    supplierTaxDocumentDate: z.string().nullable(),
    supplierTaxDocumentNumber: z.string().nullable(),
  })
  .strict();

export const receivePurchaseOrderRequestSchema = z
  .object({
    actualCosts: z.array(actualCostSchema).min(1),
    vat: vatSchema,
  })
  .strict();

export type ReceivePurchaseOrderRequest = z.infer<
  typeof receivePurchaseOrderRequestSchema
>;
