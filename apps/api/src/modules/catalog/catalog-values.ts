const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const UNICODE_WHITESPACE_RUN_PATTERN = /\p{White_Space}+/gu;
const BASE_PRICE_PATTERN = /^(\d+)(?:\.(\d{1,4}))?$/;
const MAXIMUM_BASE_PRICE_INTEGER_DIGITS = 15;

function trimmedNonBlank(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must not be blank.`);
  }

  return trimmed;
}

export interface CanonicalCategoryName {
  name: string;
  normalizedName: string;
}

export function canonicalizeCategoryName(value: string): CanonicalCategoryName {
  const name = trimmedNonBlank(value, "Category name");
  const normalizedName = value
    .normalize("NFKC")
    .trim()
    .replace(UNICODE_WHITESPACE_RUN_PATTERN, " ")
    .toLowerCase();

  if (normalizedName.length === 0) {
    throw new Error("Category name must have a nonblank normalized identity.");
  }

  return { name, normalizedName };
}

export function canonicalizeProductName(value: string): string {
  return trimmedNonBlank(value, "Product name");
}

export function canonicalizeSku(value: string): string {
  const sku = value.trim().normalize("NFKC").toUpperCase();

  if (!SKU_PATTERN.test(sku)) {
    throw new Error("SKU does not match the accepted catalog grammar.");
  }

  return sku;
}

export function canonicalizeBarcode(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const barcode = value.trim();

  if (barcode.length === 0) {
    return null;
  }

  if (CONTROL_CHARACTER_PATTERN.test(barcode)) {
    throw new Error("Barcode must not contain control characters.");
  }

  if (Array.from(barcode).length > 128) {
    throw new Error("Barcode must not exceed 128 characters.");
  }

  return barcode;
}

export function parseCatalogBasePrice(value: string): string {
  const match = BASE_PRICE_PATTERN.exec(value);

  if (match === null) {
    throw new Error(
      "Base price must be a non-negative decimal with at most four fractional digits.",
    );
  }

  const integerDigits = (match[1] ?? "").replace(/^0+/, "") || "0";

  if (integerDigits.length > MAXIMUM_BASE_PRICE_INTEGER_DIGITS) {
    throw new Error("Base price exceeds DECIMAL(19,4) storage capacity.");
  }

  return value;
}
