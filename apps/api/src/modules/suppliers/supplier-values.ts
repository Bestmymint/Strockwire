export type SupplierInputValue = string | null | undefined;

function optional(value: SupplierInputValue, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > maximum) throw new Error("Supplier value is too long.");
  return trimmed;
}

export function supplierName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 160) {
    throw new Error("Supplier name is invalid.");
  }
  return trimmed;
}

export function supplierContactName(value: SupplierInputValue): string | null {
  return optional(value, 120);
}

export function supplierEmail(value: SupplierInputValue): string | null {
  const normalized = optional(value, 254);
  if (normalized === null) return null;
  const email = normalized.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Supplier email is invalid.");
  }
  return email;
}

export function supplierPhone(value: SupplierInputValue): string | null {
  return optional(value, 40);
}

export function supplierAddress(value: SupplierInputValue): string | null {
  return optional(value, 500);
}
