-- Product and membership composite keys support tenant-safe inventory and
-- actor-provenance foreign keys without changing existing row identity.
CREATE UNIQUE INDEX "products_id_organization_id_key"
    ON "products"("id", "organization_id");

CREATE UNIQUE INDEX "organization_memberships_organization_id_id_user_id_key"
    ON "organization_memberships"("organization_id", "id", "user_id");

CREATE TABLE "inventory_balances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_balances_quantity_nonnegative_check" CHECK ("quantity" >= 0)
);

CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "delta" DECIMAL(18,4) NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "adjustment_reason" VARCHAR(50) NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID NOT NULL,
    "actor_membership_id" UUID NOT NULL,
    "idempotency_key_hash" VARCHAR(64) NOT NULL,
    "canonical_request_hash" VARCHAR(64) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_transactions_delta_nonzero_check" CHECK ("delta" <> 0),
    CONSTRAINT "inventory_transactions_source_check" CHECK (
        "source" = 'MANUAL_ADJUSTMENT'
    ),
    CONSTRAINT "inventory_transactions_adjustment_reason_check" CHECK (
        "adjustment_reason" IN (
            'STOCK_COUNT',
            'DAMAGE',
            'LOSS',
            'FOUND',
            'CORRECTION',
            'OTHER'
        )
    ),
    CONSTRAINT "inventory_transactions_note_check" CHECK (
        (
            "note" IS NULL
            AND "adjustment_reason" <> 'OTHER'
        )
        OR (
            "note" IS NOT NULL
            AND "note" = btrim("note", U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
            AND "note" <> ''
        )
    ),
    CONSTRAINT "inventory_transactions_idempotency_key_hash_check" CHECK (
        "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "inventory_transactions_canonical_request_hash_check" CHECK (
        "canonical_request_hash" ~ '^[0-9a-f]{64}$'
    )
);

CREATE UNIQUE INDEX "inventory_balances_branch_id_product_id_key"
    ON "inventory_balances"("branch_id", "product_id");

CREATE UNIQUE INDEX "inventory_transactions_organization_id_idempotency_key_hash_key"
    ON "inventory_transactions"("organization_id", "idempotency_key_hash");

CREATE INDEX "inventory_transactions_branch_product_time_idx"
    ON "inventory_transactions"("branch_id", "product_id", "occurred_at", "id");

ALTER TABLE "inventory_balances"
    ADD CONSTRAINT "inventory_balances_organization_id_fkey"
        FOREIGN KEY ("organization_id")
        REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "inventory_balances_branch_id_organization_id_fkey"
        FOREIGN KEY ("branch_id", "organization_id")
        REFERENCES "branches"("id", "organization_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "inventory_balances_product_id_organization_id_fkey"
        FOREIGN KEY ("product_id", "organization_id")
        REFERENCES "products"("id", "organization_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_organization_id_fkey"
        FOREIGN KEY ("organization_id")
        REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "inventory_transactions_branch_id_organization_id_fkey"
        FOREIGN KEY ("branch_id", "organization_id")
        REFERENCES "branches"("id", "organization_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "inventory_transactions_product_id_organization_id_fkey"
        FOREIGN KEY ("product_id", "organization_id")
        REFERENCES "products"("id", "organization_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "inventory_transactions_actor_user_id_fkey"
        FOREIGN KEY ("actor_user_id")
        REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "inventory_transactions_actor_membership_fkey"
        FOREIGN KEY ("organization_id", "actor_membership_id", "actor_user_id")
        REFERENCES "organization_memberships"("organization_id", "id", "user_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;
