-- ADR-028 adds immutable linked Sale refunds, one matching-method repayment,
-- optional same-branch stock return, and exact refund-to-ledger provenance.
CREATE TYPE "sale_refund_idempotency_operation" AS ENUM ('SALE_REFUND');

CREATE TABLE "sale_refunds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_membership_id" UUID NOT NULL,
    "reference" VARCHAR(43) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'THB',
    "actor_display_name_snapshot" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "gross_amount" DECIMAL(38,2) NOT NULL,
    "discount_amount" DECIMAL(38,2) NOT NULL,
    "sales_vat_status_snapshot" "sales_vat_status" NOT NULL,
    "sales_vat_rate_snapshot" DECIMAL(9,6),
    "taxable_amount" DECIMAL(38,2),
    "output_vat_amount" DECIMAL(38,2) NOT NULL,
    "total_amount" DECIMAL(38,2) NOT NULL,
    "operation_type" "sale_refund_idempotency_operation" NOT NULL DEFAULT 'SALE_REFUND',
    "idempotency_key_hash" VARCHAR(64) NOT NULL,
    "canonical_request_hash" VARCHAR(64) NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_refunds_reference_check" CHECK (
        "reference" ~ '^REFUND-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    CONSTRAINT "sale_refunds_currency_check" CHECK ("currency" = 'THB'),
    CONSTRAINT "sale_refunds_actor_display_name_check" CHECK (
        btrim("actor_display_name_snapshot") <> ''
    ),
    CONSTRAINT "sale_refunds_reason_check" CHECK (
        "reason" = btrim("reason", U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
        AND "reason" <> ''
    ),
    CONSTRAINT "sale_refunds_idempotency_key_hash_check" CHECK (
        "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "sale_refunds_canonical_request_hash_check" CHECK (
        "canonical_request_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "sale_refunds_amounts_check" CHECK (
        "gross_amount" >= 0
        AND "discount_amount" >= 0
        AND "discount_amount" <= "gross_amount"
        AND "output_vat_amount" >= 0
        AND "total_amount" > 0
        AND "gross_amount" - "discount_amount" = "total_amount"
    ),
    CONSTRAINT "sale_refunds_vat_snapshot_check" CHECK (
        (
            "sales_vat_status_snapshot" = 'REGISTERED'
            AND "sales_vat_rate_snapshot" IS NOT NULL
            AND "sales_vat_rate_snapshot" > 0
            AND "sales_vat_rate_snapshot" < 100
            AND "taxable_amount" IS NOT NULL
            AND "taxable_amount" >= 0
            AND "taxable_amount" + "output_vat_amount" = "total_amount"
        )
        OR (
            "sales_vat_status_snapshot" = 'NOT_REGISTERED'
            AND "sales_vat_rate_snapshot" IS NULL
            AND "taxable_amount" IS NULL
            AND "output_vat_amount" = 0
        )
    )
);

CREATE TABLE "sale_refund_items" (
    "id" UUID NOT NULL,
    "sale_refund_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "sale_item_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "refund_quantity" DECIMAL(18,4) NOT NULL,
    "restock_quantity" DECIMAL(18,4) NOT NULL,
    "reversed_line_gross" DECIMAL(38,2) NOT NULL,
    "reversed_line_discount" DECIMAL(38,2) NOT NULL,
    "reversed_line_net" DECIMAL(38,2) NOT NULL,
    "reversed_line_taxable" DECIMAL(38,2),
    "reversed_line_output_vat" DECIMAL(38,2) NOT NULL,
    "original_cost_basis_state" "inventory_cost_basis_state" NOT NULL,
    "original_unit_cost" DECIMAL(19,6),
    "cogs_reversal_amount" DECIMAL(38,10),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_refund_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_refund_items_quantity_check" CHECK (
        "refund_quantity" > 0
        AND "restock_quantity" >= 0
        AND "restock_quantity" <= "refund_quantity"
    ),
    CONSTRAINT "sale_refund_items_allocation_check" CHECK (
        "reversed_line_gross" >= 0
        AND "reversed_line_discount" >= 0
        AND "reversed_line_discount" <= "reversed_line_gross"
        AND "reversed_line_net" >= 0
        AND "reversed_line_gross" - "reversed_line_discount" = "reversed_line_net"
        AND "reversed_line_output_vat" >= 0
        AND "reversed_line_output_vat" <= "reversed_line_net"
        AND (
            (
                "reversed_line_taxable" IS NULL
                AND "reversed_line_output_vat" = 0
            )
            OR (
                "reversed_line_taxable" IS NOT NULL
                AND "reversed_line_taxable" >= 0
                AND "reversed_line_taxable" + "reversed_line_output_vat" = "reversed_line_net"
            )
        )
    ),
    CONSTRAINT "sale_refund_items_cost_shape_check" CHECK (
        (
            "original_cost_basis_state" = 'UNKNOWN'
            AND "original_unit_cost" IS NULL
            AND "cogs_reversal_amount" IS NULL
        )
        OR (
            "original_cost_basis_state" = 'KNOWN'
            AND "original_unit_cost" IS NOT NULL
            AND "original_unit_cost" >= 0
            AND "cogs_reversal_amount" IS NOT NULL
            AND "cogs_reversal_amount" >= 0
        )
    )
);

CREATE TABLE "refund_payments" (
    "id" UUID NOT NULL,
    "sale_refund_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount" DECIMAL(38,2) NOT NULL,
    "transfer_reference" VARCHAR(100),
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refund_payments_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "refund_payments_method_shape_check" CHECK (
        (
            "method" = 'CASH'
            AND "transfer_reference" IS NULL
        )
        OR (
            "method" = 'TRANSFER'
            AND "transfer_reference" IS NOT NULL
            AND "transfer_reference" = btrim("transfer_reference", U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
            AND "transfer_reference" <> ''
        )
    )
);

ALTER TABLE "inventory_transactions"
    ADD COLUMN "sale_refund_item_id" UUID,
    DROP CONSTRAINT "inventory_transactions_source_check",
    DROP CONSTRAINT "inventory_transactions_source_shape_check",
    ADD CONSTRAINT "inventory_transactions_source_check" CHECK (
        "source" IN ('MANUAL_ADJUSTMENT', 'PURCHASE_RECEIVE', 'SALE', 'SALE_REFUND_RETURN')
    ),
    ADD CONSTRAINT "inventory_transactions_source_shape_check" CHECK (
        (
            "source" = 'MANUAL_ADJUSTMENT'
            AND "purchase_receipt_item_id" IS NULL
            AND "sale_item_id" IS NULL
            AND "sale_refund_item_id" IS NULL
            AND "adjustment_reason" IS NOT NULL
            AND "idempotency_key_hash" IS NOT NULL
            AND "canonical_request_hash" IS NOT NULL
        )
        OR (
            "source" = 'PURCHASE_RECEIVE'
            AND "purchase_receipt_item_id" IS NOT NULL
            AND "sale_item_id" IS NULL
            AND "sale_refund_item_id" IS NULL
            AND "adjustment_reason" IS NULL
            AND "note" IS NULL
            AND "idempotency_key_hash" IS NULL
            AND "canonical_request_hash" IS NULL
            AND "delta" > 0
        )
        OR (
            "source" = 'SALE'
            AND "purchase_receipt_item_id" IS NULL
            AND "sale_item_id" IS NOT NULL
            AND "sale_refund_item_id" IS NULL
            AND "adjustment_reason" IS NULL
            AND "note" IS NULL
            AND "idempotency_key_hash" IS NULL
            AND "canonical_request_hash" IS NULL
            AND "delta" < 0
        )
        OR (
            "source" = 'SALE_REFUND_RETURN'
            AND "purchase_receipt_item_id" IS NULL
            AND "sale_item_id" IS NULL
            AND "sale_refund_item_id" IS NOT NULL
            AND "adjustment_reason" IS NULL
            AND "note" IS NULL
            AND "idempotency_key_hash" IS NULL
            AND "canonical_request_hash" IS NULL
            AND "delta" > 0
        )
    );

CREATE UNIQUE INDEX "sale_items_refund_scope_key"
    ON "sale_items"("id", "sale_id", "organization_id", "branch_id", "product_id");
CREATE UNIQUE INDEX "payments_refund_method_scope_key"
    ON "payments"("sale_id", "organization_id", "branch_id", "method");

CREATE UNIQUE INDEX "sale_refunds_item_scope_key"
    ON "sale_refunds"("id", "organization_id", "branch_id", "sale_id");
CREATE UNIQUE INDEX "sale_refunds_payment_scope_key"
    ON "sale_refunds"("id", "organization_id", "branch_id", "sale_id", "total_amount");
CREATE UNIQUE INDEX "sale_refunds_organization_id_reference_key"
    ON "sale_refunds"("organization_id", "reference");
CREATE UNIQUE INDEX "sale_refunds_idempotency_scope_key"
    ON "sale_refunds"("organization_id", "operation_type", "idempotency_key_hash");
CREATE INDEX "sale_refunds_sale_completed_at_id_idx"
    ON "sale_refunds"("organization_id", "branch_id", "sale_id", "completed_at", "id");

CREATE UNIQUE INDEX "sale_refund_items_refund_item_key"
    ON "sale_refund_items"("sale_refund_id", "sale_item_id");
CREATE UNIQUE INDEX "sale_refund_items_inventory_transaction_scope_key"
    ON "sale_refund_items"("id", "organization_id", "branch_id", "product_id");
CREATE INDEX "sale_refund_items_sale_item_id_idx"
    ON "sale_refund_items"("sale_item_id");

CREATE UNIQUE INDEX "refund_payments_sale_refund_id_key"
    ON "refund_payments"("sale_refund_id");
CREATE UNIQUE INDEX "refund_payments_refund_scope_key"
    ON "refund_payments"("sale_refund_id", "organization_id", "branch_id", "sale_id", "amount");

CREATE UNIQUE INDEX "inventory_transactions_sale_refund_item_scope_key"
    ON "inventory_transactions"("sale_refund_item_id", "organization_id", "branch_id", "product_id");

ALTER TABLE "sale_refunds"
    ADD CONSTRAINT "sale_refunds_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "sale_refunds_branch_id_organization_id_fkey"
        FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "sale_refunds_sale_id_organization_id_branch_id_fkey"
        FOREIGN KEY ("sale_id", "organization_id", "branch_id") REFERENCES "sales"("id", "organization_id", "branch_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "sale_refunds_actor_user_id_fkey"
        FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "sale_refunds_actor_membership_fkey"
        FOREIGN KEY ("organization_id", "actor_membership_id", "actor_user_id") REFERENCES "organization_memberships"("organization_id", "id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "sale_refund_items"
    ADD CONSTRAINT "sale_refund_items_sale_refund_scope_fkey"
        FOREIGN KEY ("sale_refund_id", "organization_id", "branch_id", "sale_id") REFERENCES "sale_refunds"("id", "organization_id", "branch_id", "sale_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "sale_refund_items_sale_item_scope_fkey"
        FOREIGN KEY ("sale_item_id", "sale_id", "organization_id", "branch_id", "product_id") REFERENCES "sale_items"("id", "sale_id", "organization_id", "branch_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "sale_refund_items_product_id_organization_id_fkey"
        FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "refund_payments"
    ADD CONSTRAINT "refund_payments_refund_scope_fkey"
        FOREIGN KEY ("sale_refund_id", "organization_id", "branch_id", "sale_id", "amount") REFERENCES "sale_refunds"("id", "organization_id", "branch_id", "sale_id", "total_amount") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "refund_payments_original_method_fkey"
        FOREIGN KEY ("sale_id", "organization_id", "branch_id", "method") REFERENCES "payments"("sale_id", "organization_id", "branch_id", "method") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_sale_refund_item_fkey"
        FOREIGN KEY ("sale_refund_item_id", "organization_id", "branch_id", "product_id") REFERENCES "sale_refund_items"("id", "organization_id", "branch_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
