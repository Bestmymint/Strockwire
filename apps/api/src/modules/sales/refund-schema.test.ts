import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  fileURLToPath(new URL("../../../prisma/schema.prisma", import.meta.url)),
  "utf8",
);
const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../prisma/migrations/20260919120000_add_sale_refunds/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("ADR-028 refund persistence contract", () => {
  it("defines only the three bounded refund records with exact decimal snapshots", () => {
    expect(schema).toMatch(/model SaleRefund \{/);
    expect(schema).toMatch(/model SaleRefundItem \{/);
    expect(schema).toMatch(/model RefundPayment \{/);
    expect(schema).toMatch(/refundQuantity\s+Decimal.*@db\.Decimal\(18, 4\)/);
    expect(schema).toMatch(
      /originalUnitCost\s+Decimal\?.*@db\.Decimal\(19, 6\)/,
    );
    expect(schema).toMatch(
      /cogsReversalAmount\s+Decimal\?.*@db\.Decimal\(38, 10\)/,
    );
    expect(schema).not.toMatch(/model SaleVoid|model VoidPayment/);
  });

  it("uses restrictive scope, payment, item, and return-ledger constraints", () => {
    expect(migration).toContain(
      "sale_refunds_sale_id_organization_id_branch_id_fkey",
    );
    expect(migration).toContain("sale_refund_items_sale_item_scope_fkey");
    expect(migration).toContain("refund_payments_original_method_fkey");
    expect(migration).toContain("inventory_transactions_sale_refund_item_fkey");
    expect(migration).toContain("sale_refunds_idempotency_scope_key");
    expect(migration).toContain("SALE_REFUND_RETURN");
    expect(migration).toContain('"restock_quantity" <= "refund_quantity"');
  });

  it("preserves original sale tables and adds no mutable refund status", () => {
    expect(migration).not.toMatch(/ALTER TABLE "sales"\s+ADD COLUMN "status"/);
    expect(migration).not.toMatch(/UPDATE "sales"|DELETE FROM "sales"/);
    expect(migration).not.toMatch(
      /"status".*sale_refunds|"status".*refund_payments/,
    );
  });
});
