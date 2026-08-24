import { describe, expect, it } from "vitest";

import {
  canonicalizeBarcode,
  canonicalizeCategoryName,
  canonicalizeProductName,
  canonicalizeSku,
  parseCatalogBasePrice,
} from "./catalog-values.ts";

describe("catalog values", () => {
  it("preserves the trimmed category display value and builds one Unicode identity", () => {
    const input = "  ＦＯＯＤ\u00a0\u2003Supplies  ";

    expect(canonicalizeCategoryName(input)).toEqual({
      name: "ＦＯＯＤ\u00a0\u2003Supplies",
      normalizedName: "food supplies",
    });
    expect(canonicalizeCategoryName("Food").normalizedName).toBe("food");
    expect(canonicalizeCategoryName(" food ").normalizedName).toBe("food");
    expect(canonicalizeCategoryName("FOOD").normalizedName).toBe("food");
    expect(() => canonicalizeCategoryName("\u00a0\u2003")).toThrow();
  });

  it("trims product names without changing internal whitespace or Unicode form", () => {
    const decomposedName = "Cafe\u0301  Beans";

    expect(canonicalizeProductName(`  ${decomposedName}  `)).toBe(
      decomposedName,
    );
    expect(canonicalizeProductName(`  ${decomposedName}  `)).not.toBe(
      decomposedName.normalize("NFC"),
    );
    expect(() => canonicalizeProductName("   ")).toThrow();
  });

  it("canonicalizes and validates the accepted SKU grammar boundaries", () => {
    expect(canonicalizeSku(" abc-01 ")).toBe("ABC-01");
    expect(canonicalizeSku("Abc-01")).toBe("ABC-01");
    expect(canonicalizeSku(" ａｂｃ-０１ ")).toBe("ABC-01");
    expect(canonicalizeSku("A")).toBe("A");
    expect(canonicalizeSku(`A${"0".repeat(63)}`)).toHaveLength(64);

    for (const invalid of [
      "",
      "-ABC",
      "ABC 01",
      "ABC/01",
      `A${"0".repeat(64)}`,
    ]) {
      expect(() => canonicalizeSku(invalid)).toThrow();
    }
  });

  it("canonicalizes optional barcodes without case-folding or Unicode normalization", () => {
    const decomposedBarcode = "Cafe\u0301-AbC";

    expect(canonicalizeBarcode(undefined)).toBeNull();
    expect(canonicalizeBarcode(null)).toBeNull();
    expect(canonicalizeBarcode("  ")).toBeNull();
    expect(canonicalizeBarcode(` ${decomposedBarcode} `)).toBe(
      decomposedBarcode,
    );
    expect(canonicalizeBarcode(` ${decomposedBarcode} `)).not.toBe(
      decomposedBarcode.normalize("NFC"),
    );
    expect(() => canonicalizeBarcode("ABC\u0000DEF")).toThrow();
    expect(() => canonicalizeBarcode("😀".repeat(129))).toThrow();
    expect(canonicalizeBarcode("😀".repeat(128))).toHaveLength(256);
  });

  it("accepts exact DECIMAL(19,4) prices and rejects rounding or range loss", () => {
    for (const accepted of [
      "0",
      "60",
      "60.5",
      "60.1234",
      "999999999999999.9999",
      "000000000000000.0000",
    ]) {
      expect(parseCatalogBasePrice(accepted)).toBe(accepted);
    }

    for (const invalid of [
      "-1",
      "60.12345",
      "1000000000000000",
      "1e2",
      " 1.00 ",
      "1.",
    ]) {
      expect(() => parseCatalogBasePrice(invalid)).toThrow();
    }
  });
});
