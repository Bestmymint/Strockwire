import { describe, expect, it } from "vitest";

import {
  categoryCreateRequestSchema,
  categoryListQuerySchema,
  categoryUpdateRequestSchema,
  productCreateRequestSchema,
  productListQuerySchema,
  productUpdateRequestSchema,
} from "./catalog-schemas.ts";

const UPDATED_AT = "2026-08-25T12:00:00.000Z";

describe("catalog API schemas", () => {
  it("normalizes category creation and optional descriptions", () => {
    expect(
      categoryCreateRequestSchema.parse({
        description: "  Shelf  stable  ",
        name: "  ＦＯＯＤ\u00a0Supplies  ",
      }),
    ).toEqual({
      description: "Shelf  stable",
      name: {
        name: "ＦＯＯＤ\u00a0Supplies",
        normalizedName: "food supplies",
      },
    });
    expect(
      categoryCreateRequestSchema.parse({ name: "Food", description: " " }),
    ).toMatchObject({ description: null });
    expect(
      categoryCreateRequestSchema.safeParse({
        name: "Food",
        status: "INACTIVE",
      }).success,
    ).toBe(false);
  });

  it("requires one mutable category field and an exact millisecond timestamp", () => {
    expect(
      categoryUpdateRequestSchema.safeParse({ expectedUpdatedAt: UPDATED_AT })
        .success,
    ).toBe(false);
    expect(
      categoryUpdateRequestSchema.parse({
        description: null,
        expectedUpdatedAt: UPDATED_AT,
      }),
    ).toMatchObject({
      description: null,
      expectedUpdatedAt: new Date(UPDATED_AT),
    });
  });

  it("canonicalizes product create values without numeric price coercion", () => {
    expect(
      productCreateRequestSchema.parse({
        barcode: "  Cafe\u0301-AbC  ",
        basePrice: "60.5000",
        description: " ",
        name: "  Coffee  Beans  ",
        sku: " ｃｏｆ-０１ ",
        unit: "EA",
      }),
    ).toEqual({
      barcode: "Cafe\u0301-AbC",
      basePrice: "60.5000",
      categoryId: null,
      description: null,
      name: "Coffee  Beans",
      sku: "COF-01",
      unit: "EA",
    });
    expect(
      productCreateRequestSchema.safeParse({
        basePrice: 60,
        name: "Coffee",
        sku: "COF",
        unit: "EA",
      }).success,
    ).toBe(false);
    expect(
      productCreateRequestSchema.safeParse({
        basePrice: "60.12345",
        name: "Coffee",
        sku: "COF",
        unit: "EA",
      }).success,
    ).toBe(false);
  });

  it("rejects immutable unit and requires a mutable product field on PATCH", () => {
    expect(
      productUpdateRequestSchema.safeParse({
        expectedUpdatedAt: UPDATED_AT,
        unit: "KG",
      }).success,
    ).toBe(false);
    expect(
      productUpdateRequestSchema.safeParse({ expectedUpdatedAt: UPDATED_AT })
        .success,
    ).toBe(false);
    expect(
      productUpdateRequestSchema.parse({
        barcode: " ",
        expectedUpdatedAt: UPDATED_AT,
      }),
    ).toMatchObject({ barcode: null });
  });

  it("applies list defaults and validates bounded limits", () => {
    expect(categoryListQuerySchema.parse({})).toMatchObject({
      includeInactive: false,
      limit: 25,
      q: "",
    });
    expect(categoryListQuerySchema.parse({ q: "  ＦＯＯＤ  " }).q).toBe("food");
    expect(
      productListQuerySchema.parse({ limit: "100", q: "  abc  " }),
    ).toMatchObject({
      includeInactive: false,
      limit: 100,
      q: "abc",
    });
    expect(productListQuerySchema.safeParse({ limit: "101" }).success).toBe(
      false,
    );
  });
});
