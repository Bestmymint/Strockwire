-- Sales persistence adds Organization VAT configuration, immutable completed Sale
-- facts, one confirmed Payment, and exact Sale-to-ledger provenance.
CREATE TYPE "sales_vat_status" AS ENUM ('UNCONFIGURED', 'NOT_REGISTERED', 'REGISTERED');
CREATE TYPE "sale_discount_type" AS ENUM ('AMOUNT', 'PERCENT');
CREATE TYPE "sale_idempotency_operation" AS ENUM ('SALE_CHECKOUT');
CREATE TYPE "payment_method" AS ENUM ('CASH', 'TRANSFER');

ALTER TABLE "organizations"
    ADD COLUMN "sales_vat_status" "sales_vat_status" NOT NULL DEFAULT 'UNCONFIGURED',
    ADD COLUMN "sales_vat_rate" DECIMAL(9,6),
    ADD CONSTRAINT "organizations_sales_vat_configuration_check" CHECK (
        (
            "sales_vat_status" IN ('UNCONFIGURED', 'NOT_REGISTERED')
            AND "sales_vat_rate" IS NULL
        )
        OR (
            "sales_vat_status" = 'REGISTERED'
            AND "sales_vat_rate" IS NOT NULL
            AND "sales_vat_rate" > 0
            AND "sales_vat_rate" < 100
        )
    );

CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_membership_id" UUID NOT NULL,
    "reference" VARCHAR(41) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'THB',
    "organization_name_snapshot" VARCHAR(200) NOT NULL,
    "branch_name_snapshot" VARCHAR(200) NOT NULL,
    "branch_code_snapshot" VARCHAR(32) NOT NULL,
    "actor_display_name_snapshot" VARCHAR(200) NOT NULL,
    "subtotal_amount" DECIMAL(38,2) NOT NULL,
    "discount_type" "sale_discount_type",
    "discount_amount_input" DECIMAL(38,2),
    "discount_percent_input" DECIMAL(7,4),
    "discount_reason" VARCHAR(200),
    "discount_amount" DECIMAL(38,2) NOT NULL DEFAULT 0,
    "sales_vat_status_snapshot" "sales_vat_status" NOT NULL,
    "sales_vat_rate_snapshot" DECIMAL(9,6),
    "taxable_amount" DECIMAL(38,2),
    "output_vat_amount" DECIMAL(38,2) NOT NULL,
    "total_amount" DECIMAL(38,2) NOT NULL,
    "operation_type" "sale_idempotency_operation" NOT NULL DEFAULT 'SALE_CHECKOUT',
    "idempotency_key_hash" VARCHAR(64) NOT NULL,
    "canonical_request_hash" VARCHAR(64) NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_reference_check" CHECK (
        "reference" ~ '^SALE-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    CONSTRAINT "sales_currency_check" CHECK ("currency" = 'THB'),
    CONSTRAINT "sales_snapshot_text_check" CHECK (
        btrim("organization_name_snapshot") <> ''
        AND btrim("branch_name_snapshot") <> ''
        AND btrim("branch_code_snapshot") <> ''
        AND btrim("actor_display_name_snapshot") <> ''
    ),
    CONSTRAINT "sales_idempotency_key_hash_check" CHECK (
        "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "sales_canonical_request_hash_check" CHECK (
        "canonical_request_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "sales_amounts_check" CHECK (
        "subtotal_amount" >= 0
        AND "discount_amount" >= 0
        AND "discount_amount" <= "subtotal_amount"
        AND "output_vat_amount" >= 0
        AND "total_amount" > 0
        AND "subtotal_amount" - "discount_amount" = "total_amount"
    ),
    CONSTRAINT "sales_discount_shape_check" CHECK (
        (
            "discount_type" IS NULL
            AND "discount_amount_input" IS NULL
            AND "discount_percent_input" IS NULL
            AND "discount_reason" IS NULL
            AND "discount_amount" = 0
        )
        OR (
            "discount_type" = 'AMOUNT'
            AND "discount_amount_input" IS NOT NULL
            AND "discount_amount_input" > 0
            AND "discount_amount_input" < "subtotal_amount"
            AND "discount_percent_input" IS NULL
            AND "discount_amount" = "discount_amount_input"
            AND "discount_reason" IS NOT NULL
            AND "discount_reason" = btrim("discount_reason")
            AND "discount_reason" <> ''
        )
        OR (
            "discount_type" = 'PERCENT'
            AND "discount_amount_input" IS NULL
            AND "discount_percent_input" IS NOT NULL
            AND "discount_percent_input" > 0
            AND "discount_percent_input" < 100
            AND "discount_amount" = round(
                "subtotal_amount" * "discount_percent_input" / 100,
                2
            )
            AND "discount_reason" IS NOT NULL
            AND "discount_reason" = btrim("discount_reason")
            AND "discount_reason" <> ''
        )
    ),
    CONSTRAINT "sales_vat_snapshot_check" CHECK (
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

CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_sku_snapshot" VARCHAR(64) NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "product_unit_snapshot" "product_unit" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "line_gross" DECIMAL(38,2) NOT NULL,
    "line_discount" DECIMAL(38,2) NOT NULL,
    "line_net" DECIMAL(38,2) NOT NULL,
    "line_taxable" DECIMAL(38,2),
    "line_output_vat" DECIMAL(38,2) NOT NULL,
    "cost_basis_state" "inventory_cost_basis_state" NOT NULL,
    "unit_cost" DECIMAL(19,6),
    "cogs_amount" DECIMAL(38,10),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_items_snapshot_text_check" CHECK (
        btrim("product_sku_snapshot") <> '' AND btrim("product_name_snapshot") <> ''
    ),
    CONSTRAINT "sale_items_quantity_price_check" CHECK (
        "quantity" > 0 AND "unit_price" >= 0
    ),
    CONSTRAINT "sale_items_allocation_check" CHECK (
        "line_gross" >= 0
        AND "line_discount" >= 0
        AND "line_discount" <= "line_gross"
        AND "line_net" >= 0
        AND "line_gross" - "line_discount" = "line_net"
        AND "line_output_vat" >= 0
        AND "line_output_vat" <= "line_net"
        AND (
            (
                "line_taxable" IS NULL
                AND "line_output_vat" = 0
            )
            OR (
                "line_taxable" IS NOT NULL
                AND "line_taxable" >= 0
                AND "line_taxable" + "line_output_vat" = "line_net"
            )
        )
    ),
    CONSTRAINT "sale_items_cost_shape_check" CHECK (
        (
            "cost_basis_state" = 'UNKNOWN'
            AND "unit_cost" IS NULL
            AND "cogs_amount" IS NULL
        )
        OR (
            "cost_basis_state" = 'KNOWN'
            AND "unit_cost" IS NOT NULL
            AND "unit_cost" >= 0
            AND "cogs_amount" IS NOT NULL
            AND "cogs_amount" >= 0
            AND "cogs_amount" = round("quantity" * "unit_cost", 10)
        )
    )
);

CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount" DECIMAL(38,2) NOT NULL,
    "amount_tendered" DECIMAL(38,2),
    "change_amount" DECIMAL(38,2),
    "transfer_reference" VARCHAR(100),
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "payments_method_shape_check" CHECK (
        (
            "method" = 'CASH'
            AND "amount_tendered" IS NOT NULL
            AND "amount_tendered" >= "amount"
            AND "change_amount" IS NOT NULL
            AND "change_amount" >= 0
            AND "amount_tendered" - "change_amount" = "amount"
            AND "transfer_reference" IS NULL
        )
        OR (
            "method" = 'TRANSFER'
            AND "amount_tendered" IS NULL
            AND "change_amount" IS NULL
            AND (
                "transfer_reference" IS NULL
                OR (
                    "transfer_reference" = btrim("transfer_reference")
                    AND "transfer_reference" <> ''
                )
            )
        )
    )
);

ALTER TABLE "inventory_transactions"
    ADD COLUMN "sale_item_id" UUID,
    DROP CONSTRAINT "inventory_transactions_source_check",
    DROP CONSTRAINT "inventory_transactions_source_shape_check",
    ADD CONSTRAINT "inventory_transactions_source_check" CHECK (
        "source" IN ('MANUAL_ADJUSTMENT', 'PURCHASE_RECEIVE', 'SALE')
    ),
    ADD CONSTRAINT "inventory_transactions_source_shape_check" CHECK (
        (
            "source" = 'MANUAL_ADJUSTMENT'
            AND "purchase_receipt_item_id" IS NULL
            AND "sale_item_id" IS NULL
            AND "adjustment_reason" IS NOT NULL
            AND "idempotency_key_hash" IS NOT NULL
            AND "canonical_request_hash" IS NOT NULL
        )
        OR (
            "source" = 'PURCHASE_RECEIVE'
            AND "purchase_receipt_item_id" IS NOT NULL
            AND "sale_item_id" IS NULL
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
            AND "adjustment_reason" IS NULL
            AND "note" IS NULL
            AND "idempotency_key_hash" IS NULL
            AND "canonical_request_hash" IS NULL
            AND "delta" < 0
        )
    );

CREATE UNIQUE INDEX "sales_item_scope_key"
    ON "sales"("id", "organization_id", "branch_id");
CREATE UNIQUE INDEX "sales_payment_scope_key"
    ON "sales"("id", "organization_id", "branch_id", "total_amount");
CREATE UNIQUE INDEX "sales_organization_id_reference_key"
    ON "sales"("organization_id", "reference");
CREATE UNIQUE INDEX "sales_idempotency_scope_key"
    ON "sales"("organization_id", "operation_type", "idempotency_key_hash");
CREATE INDEX "sales_organization_branch_completed_at_id_idx"
    ON "sales"("organization_id", "branch_id", "completed_at", "id");

CREATE UNIQUE INDEX "sale_items_sale_id_product_id_key"
    ON "sale_items"("sale_id", "product_id");
CREATE UNIQUE INDEX "sale_items_inventory_transaction_scope_key"
    ON "sale_items"("id", "organization_id", "branch_id", "product_id");

CREATE UNIQUE INDEX "payments_sale_id_key"
    ON "payments"("sale_id");
CREATE UNIQUE INDEX "payments_sale_scope_key"
    ON "payments"("sale_id", "organization_id", "branch_id", "amount");

CREATE UNIQUE INDEX "inventory_transactions_sale_item_scope_key"
    ON "inventory_transactions"("sale_item_id", "organization_id", "branch_id", "product_id");

ALTER TABLE "sales"
    ADD CONSTRAINT "sales_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "sales_branch_id_organization_id_fkey"
        FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "sales_actor_user_id_fkey"
        FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "sales_actor_membership_fkey"
        FOREIGN KEY ("organization_id", "actor_membership_id", "actor_user_id") REFERENCES "organization_memberships"("organization_id", "id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "sale_items"
    ADD CONSTRAINT "sale_items_sale_id_organization_id_branch_id_fkey"
        FOREIGN KEY ("sale_id", "organization_id", "branch_id") REFERENCES "sales"("id", "organization_id", "branch_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "sale_items_product_id_organization_id_fkey"
        FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_sale_scope_fkey"
        FOREIGN KEY ("sale_id", "organization_id", "branch_id", "amount") REFERENCES "sales"("id", "organization_id", "branch_id", "total_amount") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_sale_item_fkey"
        FOREIGN KEY ("sale_item_id", "organization_id", "branch_id", "product_id") REFERENCES "sale_items"("id", "organization_id", "branch_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
