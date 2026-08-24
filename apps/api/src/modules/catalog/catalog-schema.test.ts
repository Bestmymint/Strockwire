import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestPrismaClient,
  resetTestDatabase,
} from "../../test/database-harness.ts";
import { loadTestDatabaseEnvironment } from "../../test/database-environment.ts";
import {
  canonicalizeBarcode,
  canonicalizeCategoryName,
  canonicalizeProductName,
  canonicalizeSku,
  parseCatalogBasePrice,
} from "./catalog-values.ts";

const environment = loadTestDatabaseEnvironment();
const prisma = createTestPrismaClient(environment);

async function createOrganization(name: string) {
  return prisma.organization.create({ data: { name } });
}

async function createCategory(
  organizationId: string,
  rawName: string,
  status: "ACTIVE" | "INACTIVE" = "ACTIVE",
) {
  const categoryName = canonicalizeCategoryName(rawName);

  return prisma.category.create({
    data: {
      ...categoryName,
      organizationId,
      status,
    },
  });
}

interface ProductOptions {
  barcode?: string | null;
  basePrice?: string;
  categoryId?: string | null;
  name?: string;
  sku?: string;
  status?: "ACTIVE" | "INACTIVE";
  unit?: "EA" | "PACK" | "BOX" | "KG" | "G" | "L" | "ML" | "M" | "CM";
}

async function createProduct(
  organizationId: string,
  options: ProductOptions = {},
) {
  return prisma.product.create({
    data: {
      barcode: canonicalizeBarcode(options.barcode),
      basePrice: parseCatalogBasePrice(options.basePrice ?? "10.0000"),
      categoryId: options.categoryId ?? null,
      name: canonicalizeProductName(options.name ?? "Catalog Product"),
      organizationId,
      sku: canonicalizeSku(options.sku ?? "CATALOG-1"),
      status: options.status ?? "ACTIVE",
      unit: options.unit ?? "EA",
    },
  });
}

function expectOneWinner(results: PromiseSettledResult<unknown>[]): void {
  expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
    results.length - 1,
  );
}

describe("catalog database schema", () => {
  beforeEach(async () => {
    await resetTestDatabase(environment);
  });

  afterAll(async () => {
    await resetTestDatabase(environment);
    await prisma.$disconnect();
  });

  it("persists canonical categories, Unicode display values, and both lifecycle states", async () => {
    const organization = await createOrganization("Category Organization");
    const unicodeName = "Ｃａｆｅ Cafe\u0301\u00a0Goods";
    const active = await createCategory(organization.id, `  ${unicodeName}  `);
    const inactive = await createCategory(
      organization.id,
      "Inactive",
      "INACTIVE",
    );

    expect(active).toMatchObject({
      name: unicodeName,
      normalizedName: "cafe café goods",
      status: "ACTIVE",
    });
    expect(active.name).not.toBe(active.name.normalize("NFC"));
    expect(inactive.status).toBe("INACTIVE");
    expect(active.updatedAt.getMilliseconds()).toBeGreaterThanOrEqual(0);

    await expect(
      prisma.category.create({
        data: {
          name: "\u00a0\u2003",
          normalizedName: "blank",
          organizationId: organization.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.category.create({
        data: {
          name: "Untrimmed\u00a0",
          normalizedName: "untrimmed",
          organizationId: organization.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces normalized category identity only within one organization", async () => {
    const firstOrganization = await createOrganization("First Category Org");
    const secondOrganization = await createOrganization("Second Category Org");
    await createCategory(firstOrganization.id, "Food");

    await expect(
      createCategory(firstOrganization.id, " food "),
    ).rejects.toThrow();
    await expect(
      createCategory(firstOrganization.id, "ＦＯＯＤ"),
    ).rejects.toThrow();
    await expect(
      createCategory(secondOrganization.id, "FOOD"),
    ).resolves.toBeDefined();
  });

  it("allows uncategorized and same-organization products but rejects cross-tenant categories", async () => {
    const firstOrganization = await createOrganization("First Product Org");
    const secondOrganization = await createOrganization("Second Product Org");
    const firstCategory = await createCategory(firstOrganization.id, "First");
    const crossTenantCategory = await createCategory(
      secondOrganization.id,
      "Second",
    );

    const uncategorized = await createProduct(firstOrganization.id, {
      sku: "UNCATEGORIZED",
    });
    const categorized = await createProduct(firstOrganization.id, {
      categoryId: firstCategory.id,
      sku: "CATEGORIZED",
    });

    expect(uncategorized.categoryId).toBeNull();
    expect(categorized.categoryId).toBe(firstCategory.id);
    await expect(
      createProduct(firstOrganization.id, {
        categoryId: crossTenantCategory.id,
        sku: "CROSS-TENANT",
      }),
    ).rejects.toThrow();
  });

  it("allows duplicate product names but rejects blank or untrimmed storage", async () => {
    const organization = await createOrganization("Product Name Org");
    const first = await createProduct(organization.id, {
      name: "Same  Name",
      sku: "SAME-NAME-1",
    });
    const second = await createProduct(organization.id, {
      name: "Same  Name",
      sku: "SAME-NAME-2",
    });

    expect(first.name).toBe("Same  Name");
    expect(second.name).toBe(first.name);
    await expect(
      prisma.product.create({
        data: {
          basePrice: "1",
          name: "\u00a0\u2003",
          organizationId: organization.id,
          sku: "BLANK-NAME",
          unit: "EA",
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.product.create({
        data: {
          basePrice: "1",
          name: "Untrimmed\u00a0",
          organizationId: organization.id,
          sku: "UNTRIMMED-NAME",
          unit: "EA",
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces canonical SKU grammar and organization-scoped uniqueness", async () => {
    const firstOrganization = await createOrganization("First SKU Org");
    const secondOrganization = await createOrganization("Second SKU Org");
    await createProduct(firstOrganization.id, { sku: " abc-01 " });

    await expect(
      createProduct(firstOrganization.id, { sku: "Abc-01" }),
    ).rejects.toThrow();
    await expect(
      createProduct(secondOrganization.id, { sku: "ABC-01" }),
    ).resolves.toMatchObject({ sku: "ABC-01" });
    await expect(
      prisma.product.create({
        data: {
          basePrice: "1",
          name: "Invalid SKU",
          organizationId: firstOrganization.id,
          sku: "lowercase",
          unit: "EA",
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces exact optional barcode storage and scoped non-null uniqueness", async () => {
    const firstOrganization = await createOrganization("First Barcode Org");
    const secondOrganization = await createOrganization("Second Barcode Org");
    const preserved = "Cafe\u0301-AbC";
    const first = await createProduct(firstOrganization.id, {
      barcode: ` ${preserved} `,
      sku: "BARCODE-1",
    });
    await createProduct(firstOrganization.id, {
      barcode: "  ",
      sku: "NULL-BARCODE-1",
    });
    await createProduct(firstOrganization.id, {
      barcode: null,
      sku: "NULL-BARCODE-2",
    });

    expect(first.barcode).toBe(preserved);
    expect(first.barcode).not.toBe(preserved.normalize("NFC"));
    await expect(
      createProduct(firstOrganization.id, {
        barcode: preserved,
        sku: "BARCODE-2",
      }),
    ).rejects.toThrow();
    await expect(
      createProduct(secondOrganization.id, {
        barcode: preserved,
        sku: "BARCODE-OTHER",
      }),
    ).resolves.toBeDefined();
    expect(
      await prisma.product.count({
        where: { barcode: null, organizationId: firstOrganization.id },
      }),
    ).toBe(2);
    await expect(
      prisma.product.create({
        data: {
          barcode: "UNTRIMMED\u00a0",
          basePrice: "1",
          name: "Untrimmed Barcode",
          organizationId: firstOrganization.id,
          sku: "UNTRIMMED-BARCODE",
          unit: "EA",
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.product.create({
        data: {
          barcode: "ABC\u0001DEF",
          basePrice: "1",
          name: "Control Barcode",
          organizationId: firstOrganization.id,
          sku: "CONTROL-BARCODE",
          unit: "EA",
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.product.create({
        data: {
          barcode: "X".repeat(129),
          basePrice: "1",
          name: "Long Barcode",
          organizationId: firstOrganization.id,
          sku: "LONG-BARCODE",
          unit: "EA",
        },
      }),
    ).rejects.toThrow();
  });

  it("persists exact non-negative DECIMAL(19,4) prices without application rounding", async () => {
    const organization = await createOrganization("Price Org");
    const zero = await createProduct(organization.id, {
      basePrice: "0",
      sku: "PRICE-ZERO",
    });
    const ordinary = await createProduct(organization.id, {
      basePrice: "60.5",
      sku: "PRICE-ORDINARY",
    });
    const fourPlaces = await createProduct(organization.id, {
      basePrice: "60.1234",
      sku: "PRICE-FOUR",
    });

    expect(zero.basePrice.toFixed(4)).toBe("0.0000");
    expect(ordinary.basePrice.toFixed(4)).toBe("60.5000");
    expect(fourPlaces.basePrice.toFixed(4)).toBe("60.1234");
    expect(() => parseCatalogBasePrice("60.12345")).toThrow();
    await expect(
      prisma.product.create({
        data: {
          basePrice: "-0.0001",
          name: "Negative Price",
          organizationId: organization.id,
          sku: "PRICE-NEGATIVE",
          unit: "EA",
        },
      }),
    ).rejects.toThrow();
  });

  it("persists every accepted unit and exposes no quantity or conversion schema", async () => {
    const organization = await createOrganization("Unit Org");
    const units = [
      "EA",
      "PACK",
      "BOX",
      "KG",
      "G",
      "L",
      "ML",
      "M",
      "CM",
    ] as const;

    for (const unit of units) {
      await createProduct(organization.id, { sku: `UNIT-${unit}`, unit });
    }

    expect(
      await prisma.product.findMany({
        orderBy: { sku: "asc" },
        select: { unit: true },
      }),
    ).toHaveLength(units.length);
    await expect(
      prisma.$executeRaw`
        INSERT INTO "products" (
          "id", "organization_id", "name", "sku", "base_price", "unit", "updated_at"
        ) VALUES (
          gen_random_uuid(),
          ${organization.id}::uuid,
          'Unsupported Unit',
          'UNIT-UNSUPPORTED',
          1,
          CAST(${"DOZEN"} AS "product_unit"),
          CURRENT_TIMESTAMP
        )
      `,
    ).rejects.toThrow();

    const columns = await prisma.$queryRaw<{ columnName: string }[]>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
      ORDER BY ordinal_position
    `;
    expect(columns.map(({ columnName }) => columnName)).toEqual([
      "id",
      "organization_id",
      "category_id",
      "name",
      "description",
      "sku",
      "barcode",
      "base_price",
      "unit",
      "status",
      "created_at",
      "updated_at",
    ]);
  });

  it("preserves inactive category relationships and restrictive catalog history", async () => {
    const organization = await createOrganization("Lifecycle Org");
    const category = await createCategory(organization.id, "Referenced");
    const product = await createProduct(organization.id, {
      categoryId: category.id,
      sku: "LIFECYCLE",
      status: "INACTIVE",
    });

    const inactiveCategory = await prisma.category.update({
      data: { status: "INACTIVE" },
      where: { id: category.id },
    });
    expect(inactiveCategory.status).toBe("INACTIVE");
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
        .categoryId,
    ).toBe(category.id);
    await expect(
      prisma.category.delete({ where: { id: category.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.organization.delete({ where: { id: organization.id } }),
    ).rejects.toThrow();
  });

  it("serializes concurrent category, SKU, and barcode duplicates at the database boundary", async () => {
    const organization = await createOrganization("Concurrency Org");

    const categoryResults = await Promise.allSettled([
      createCategory(organization.id, "Food"),
      createCategory(organization.id, " food "),
      createCategory(organization.id, "ＦＯＯＤ"),
    ]);
    expectOneWinner(categoryResults);
    expect(await prisma.category.count()).toBe(1);

    const skuResults = await Promise.allSettled([
      createProduct(organization.id, { name: "SKU A", sku: " abc-01 " }),
      createProduct(organization.id, { name: "SKU B", sku: "Abc-01" }),
      createProduct(organization.id, { name: "SKU C", sku: "ABC-01" }),
    ]);
    expectOneWinner(skuResults);
    expect(await prisma.product.count({ where: { sku: "ABC-01" } })).toBe(1);

    const barcodeResults = await Promise.allSettled([
      createProduct(organization.id, {
        barcode: " RACE-BARCODE ",
        sku: "BAR-RACE-1",
      }),
      createProduct(organization.id, {
        barcode: "RACE-BARCODE",
        sku: "BAR-RACE-2",
      }),
      createProduct(organization.id, {
        barcode: "RACE-BARCODE",
        sku: "BAR-RACE-3",
      }),
    ]);
    expectOneWinner(barcodeResults);
    expect(
      await prisma.product.count({ where: { barcode: "RACE-BARCODE" } }),
    ).toBe(1);
  });
});
