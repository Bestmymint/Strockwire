-- Receipt receiving adds immutable purchasing provenance, Branch/Product cost
-- state, and the ledger linkage needed for one atomic receiving transaction.
CREATE TYPE "inventory_cost_basis_state" AS ENUM ('UNKNOWN', 'KNOWN');

ALTER TABLE "inventory_transactions"
    ADD COLUMN "purchase_receipt_item_id" UUID,
    ALTER COLUMN "adjustment_reason" DROP NOT NULL,
    ALTER COLUMN "idempotency_key_hash" DROP NOT NULL,
    ALTER COLUMN "canonical_request_hash" DROP NOT NULL;

ALTER TABLE "inventory_transactions"
    DROP CONSTRAINT "inventory_transactions_source_check",
    DROP CONSTRAINT "inventory_transactions_note_check",
    ADD CONSTRAINT "inventory_transactions_source_check" CHECK (
        "source" IN ('MANUAL_ADJUSTMENT', 'PURCHASE_RECEIVE')
    ),
    ADD CONSTRAINT "inventory_transactions_source_shape_check" CHECK (
        (
            "source" = 'MANUAL_ADJUSTMENT'
            AND "purchase_receipt_item_id" IS NULL
            AND "adjustment_reason" IS NOT NULL
            AND "idempotency_key_hash" IS NOT NULL
            AND "canonical_request_hash" IS NOT NULL
        )
        OR (
            "source" = 'PURCHASE_RECEIVE'
            AND "purchase_receipt_item_id" IS NOT NULL
            AND "adjustment_reason" IS NULL
            AND "note" IS NULL
            AND "idempotency_key_hash" IS NULL
            AND "canonical_request_hash" IS NULL
            AND "delta" > 0
        )
    ),
    ADD CONSTRAINT "inventory_transactions_note_check" CHECK (
        "source" = 'PURCHASE_RECEIVE'
        OR (
            "note" IS NULL
            AND "adjustment_reason" <> 'OTHER'
        )
        OR (
            "note" IS NOT NULL
            AND "note" = btrim("note", U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
            AND "note" <> ''
        )
    );

CREATE TABLE "purchase_receipts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "received_by_user_id" UUID NOT NULL,
    "received_by_membership_id" UUID NOT NULL,
    "idempotency_key_hash" VARCHAR(64) NOT NULL,
    "canonical_request_hash" VARCHAR(64) NOT NULL,
    "organization_vat_registered_snapshot" BOOLEAN NOT NULL,
    "input_vat_rate" DECIMAL(9,6),
    "input_vat_amount" DECIMAL(19,4),
    "supplier_tax_document_number" VARCHAR(100),
    "supplier_tax_document_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_receipts_idempotency_key_hash_check" CHECK (
        "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "purchase_receipts_canonical_request_hash_check" CHECK (
        "canonical_request_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "purchase_receipts_input_vat_check" CHECK (
        ("input_vat_rate" IS NULL AND "input_vat_amount" IS NULL)
        OR (
            "organization_vat_registered_snapshot"
            AND "input_vat_rate" IS NOT NULL
            AND "input_vat_rate" >= 0
            AND "input_vat_amount" IS NOT NULL
            AND "input_vat_amount" >= 0
        )
    ),
    CONSTRAINT "purchase_receipts_tax_document_number_check" CHECK (
        "supplier_tax_document_number" IS NULL
        OR (
            "supplier_tax_document_number" = btrim("supplier_tax_document_number")
            AND "supplier_tax_document_number" <> ''
        )
    )
);

CREATE TABLE "purchase_receipt_items" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_sku_snapshot" VARCHAR(64) NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "received_quantity" DECIMAL(18,4) NOT NULL,
    "actual_unit_cost" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_receipt_items_received_quantity_positive_check" CHECK (
        "received_quantity" > 0
    ),
    CONSTRAINT "purchase_receipt_items_actual_unit_cost_nonnegative_check" CHECK (
        "actual_unit_cost" >= 0
    )
);

CREATE TABLE "inventory_cost_states" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "basis_state" "inventory_cost_basis_state" NOT NULL DEFAULT 'UNKNOWN',
    "inventory_value" DECIMAL(38,10),
    "average_unit_cost" DECIMAL(19,6),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_cost_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_cost_states_basis_shape_check" CHECK (
        (
            "basis_state" = 'UNKNOWN'
            AND "inventory_value" IS NULL
            AND "average_unit_cost" IS NULL
        )
        OR (
            "basis_state" = 'KNOWN'
            AND "inventory_value" IS NOT NULL
            AND "inventory_value" >= 0
            AND "average_unit_cost" IS NOT NULL
            AND "average_unit_cost" >= 0
        )
    )
);

CREATE INDEX "purchase_receipts_organization_branch_received_at_id_idx"
    ON "purchase_receipts"("organization_id", "branch_id", "received_at", "id");
CREATE UNIQUE INDEX "purchase_receipts_id_organization_id_key"
    ON "purchase_receipts"("id", "organization_id");
CREATE UNIQUE INDEX "purchase_receipts_item_scope_key"
    ON "purchase_receipts"("id", "organization_id", "purchase_order_id", "branch_id");
CREATE UNIQUE INDEX "purchase_receipts_purchase_order_id_organization_id_key"
    ON "purchase_receipts"("purchase_order_id", "organization_id");
CREATE UNIQUE INDEX "purchase_receipts_purchase_order_scope_key"
    ON "purchase_receipts"("purchase_order_id", "organization_id", "branch_id", "supplier_id");
CREATE UNIQUE INDEX "purchase_receipts_organization_id_reference_key"
    ON "purchase_receipts"("organization_id", "reference");
CREATE UNIQUE INDEX "purchase_receipts_organization_id_idempotency_key_hash_key"
    ON "purchase_receipts"("organization_id", "idempotency_key_hash");
CREATE UNIQUE INDEX "purchase_receipt_items_receipt_id_product_id_key"
    ON "purchase_receipt_items"("receipt_id", "product_id");
CREATE UNIQUE INDEX "purchase_receipt_items_purchase_order_item_scope_key"
    ON "purchase_receipt_items"("purchase_order_item_id", "organization_id", "purchase_order_id", "product_id");
CREATE UNIQUE INDEX "purchase_receipt_items_inventory_transaction_scope_key"
    ON "purchase_receipt_items"("id", "organization_id", "branch_id", "product_id");
CREATE UNIQUE INDEX "inventory_cost_states_branch_id_product_id_key"
    ON "inventory_cost_states"("branch_id", "product_id");
CREATE UNIQUE INDEX "inventory_transactions_purchase_receipt_item_scope_key"
    ON "inventory_transactions"("purchase_receipt_item_id", "organization_id", "branch_id", "product_id");
CREATE UNIQUE INDEX "purchase_order_items_receipt_scope_key"
    ON "purchase_order_items"("id", "organization_id", "purchase_order_id", "product_id");
CREATE UNIQUE INDEX "purchase_orders_receipt_scope_key"
    ON "purchase_orders"("id", "organization_id", "branch_id", "supplier_id");

ALTER TABLE "purchase_receipts"
    ADD CONSTRAINT "purchase_receipts_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "purchase_receipts_branch_id_organization_id_fkey"
        FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "purchase_receipts_supplier_id_organization_id_fkey"
        FOREIGN KEY ("supplier_id", "organization_id") REFERENCES "suppliers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "purchase_receipts_purchase_order_id_organization_id_branch_fkey"
        FOREIGN KEY ("purchase_order_id", "organization_id", "branch_id", "supplier_id") REFERENCES "purchase_orders"("id", "organization_id", "branch_id", "supplier_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "purchase_receipts_received_by_user_id_fkey"
        FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "purchase_receipts_organization_id_received_by_membership_i_fkey"
        FOREIGN KEY ("organization_id", "received_by_membership_id", "received_by_user_id") REFERENCES "organization_memberships"("organization_id", "id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "purchase_receipt_items"
    ADD CONSTRAINT "purchase_receipt_items_receipt_id_organization_id_purchase_fkey"
        FOREIGN KEY ("receipt_id", "organization_id", "purchase_order_id", "branch_id") REFERENCES "purchase_receipts"("id", "organization_id", "purchase_order_id", "branch_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "purchase_receipt_items_purchase_order_item_id_organization_fkey"
        FOREIGN KEY ("purchase_order_item_id", "organization_id", "purchase_order_id", "product_id") REFERENCES "purchase_order_items"("id", "organization_id", "purchase_order_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "purchase_receipt_items_product_id_organization_id_fkey"
        FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventory_cost_states"
    ADD CONSTRAINT "inventory_cost_states_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "inventory_cost_states_branch_id_organization_id_fkey"
        FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "inventory_cost_states_product_id_organization_id_fkey"
        FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_purchase_receipt_item_fkey"
        FOREIGN KEY ("purchase_receipt_item_id", "organization_id", "branch_id", "product_id") REFERENCES "purchase_receipt_items"("id", "organization_id", "branch_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
