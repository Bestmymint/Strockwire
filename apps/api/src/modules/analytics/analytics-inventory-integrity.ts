import { Prisma } from "../../generated/prisma/client.ts";

// Both inventory analytics and reorder use these checks against a `page` CTE.
export const invalidInventoryMovementSql = Prisma.sql`
  (t.source = 'PURCHASE_RECEIVE' AND (r.id IS NULL OR r.received_quantity <> t.delta)) OR
  (t.source = 'SALE' AND (s.id IS NULL OR s.quantity <> -t.delta)) OR
  (t.source = 'SALE_REFUND_RETURN' AND (f.id IS NULL OR f.restock_quantity <> t.delta)) OR
  (t.source = 'MANUAL_ADJUSTMENT' AND (t.purchase_receipt_item_id IS NOT NULL OR
    t.sale_item_id IS NOT NULL OR t.sale_refund_item_id IS NOT NULL)) OR
  (page.product_unit IN ('EA', 'PACK', 'BOX') AND t.delta <> trunc(t.delta)) OR
  (t.source = 'SALE' AND s.product_unit_snapshot::text <> page.product_unit)
`;

export function inventorySourceItemErrorsSql(organizationId: string) {
  return Prisma.sql`source_item_errors AS (
    SELECT branch_id, product_id, SUM(error_count)::bigint AS error_count FROM (
      SELECT page.branch_id, page.product_id,
        COUNT(*) FILTER (WHERE item.id IS NOT NULL AND
          (movement.id IS NULL OR movement.delta <> item.received_quantity))::bigint AS error_count
      FROM page LEFT JOIN purchase_receipt_items AS item
        ON item.organization_id = ${organizationId}::uuid AND item.branch_id = page.branch_id
        AND item.product_id = page.product_id
      LEFT JOIN inventory_transactions AS movement ON movement.purchase_receipt_item_id = item.id
        AND movement.organization_id = item.organization_id
      GROUP BY page.branch_id, page.product_id
      UNION ALL
      SELECT page.branch_id, page.product_id,
        COUNT(*) FILTER (WHERE item.id IS NOT NULL AND
          (movement.id IS NULL OR movement.delta <> -item.quantity))::bigint
      FROM page LEFT JOIN sale_items AS item
        ON item.organization_id = ${organizationId}::uuid AND item.branch_id = page.branch_id
        AND item.product_id = page.product_id
      LEFT JOIN inventory_transactions AS movement ON movement.sale_item_id = item.id
        AND movement.organization_id = item.organization_id
      GROUP BY page.branch_id, page.product_id
      UNION ALL
      SELECT page.branch_id, page.product_id,
        COUNT(*) FILTER (WHERE item.id IS NOT NULL AND
          ((item.restock_quantity > 0 AND (movement.id IS NULL OR movement.delta <> item.restock_quantity))
            OR (item.restock_quantity = 0 AND movement.id IS NOT NULL)))::bigint
      FROM page LEFT JOIN sale_refund_items AS item
        ON item.organization_id = ${organizationId}::uuid AND item.branch_id = page.branch_id
        AND item.product_id = page.product_id
      LEFT JOIN inventory_transactions AS movement ON movement.sale_refund_item_id = item.id
        AND movement.organization_id = item.organization_id
      GROUP BY page.branch_id, page.product_id
    ) AS source_counts GROUP BY branch_id, product_id
  )`;
}

export function hasInventoryIntegrityError(input: {
  onHand: Prisma.Decimal;
  ledgerQuantity: Prisma.Decimal;
  invalidSourceCount: bigint;
  unit: string;
}): boolean {
  return (
    input.onHand.isNegative() ||
    !input.onHand.eq(input.ledgerQuantity) ||
    input.invalidSourceCount > 0n ||
    (["EA", "PACK", "BOX"].includes(input.unit) && !input.onHand.isInteger())
  );
}
