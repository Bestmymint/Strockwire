-- CreateEnum
CREATE TYPE "catalog_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "product_unit" AS ENUM ('EA', 'PACK', 'BOX', 'KG', 'G', 'L', 'ML', 'M', 'CM');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT COLLATE "C" NOT NULL,
    "description" TEXT,
    "status" "catalog_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "categories_name_canonical_check" CHECK (
        "name" = btrim("name", U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
        AND "name" <> ''
    ),
    CONSTRAINT "categories_normalized_name_not_blank_check" CHECK (
        btrim("normalized_name", U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> ''
    )
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" VARCHAR(64) COLLATE "C" NOT NULL,
    "barcode" VARCHAR(128) COLLATE "C",
    "base_price" DECIMAL(19,4) NOT NULL,
    "unit" "product_unit" NOT NULL,
    "status" "catalog_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_name_canonical_check" CHECK (
        "name" = btrim("name", U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
        AND "name" <> ''
    ),
    CONSTRAINT "products_sku_canonical_check" CHECK (
        "sku" = upper(normalize(btrim("sku"), NFKC))
        AND "sku" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'
    ),
    CONSTRAINT "products_barcode_canonical_check" CHECK (
        "barcode" IS NULL
        OR (
            "barcode" = btrim("barcode", U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
            AND "barcode" <> ''
            AND char_length("barcode") <= 128
            AND "barcode" !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT "products_base_price_nonnegative_check" CHECK ("base_price" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_organization_id_normalized_name_key" ON "categories"("organization_id", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_id_organization_id_key" ON "categories"("id", "organization_id");

-- CreateIndex
CREATE INDEX "categories_organization_id_status_name_idx" ON "categories"("organization_id", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_barcode_key" ON "products"("organization_id", "barcode");

-- CreateIndex
CREATE INDEX "products_organization_id_status_name_idx" ON "products"("organization_id", "status", "name");

-- CreateIndex
CREATE INDEX "products_category_id_organization_id_idx" ON "products"("category_id", "organization_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_organization_id_fkey" FOREIGN KEY ("category_id", "organization_id") REFERENCES "categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
