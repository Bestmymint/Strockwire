import { describe, expect, it } from "vitest";
import {
  supplierAddress,
  supplierContactName,
  supplierEmail,
  supplierName,
  supplierPhone,
} from "./supplier-values.ts";

describe("supplier values", () => {
  it("normalizes only the approved Supplier fields", () => {
    expect(supplierName("  Supplier  ")).toBe("Supplier");
    expect(supplierContactName("  Jane  ")).toBe("Jane");
    expect(supplierEmail("  USER@Example.COM ")).toBe("user@example.com");
    expect(supplierPhone("  02-123 4567  ")).toBe("02-123 4567");
    expect(supplierAddress("  12 Main\nRoad  ")).toBe("12 Main\nRoad");
    expect(supplierContactName(" ")).toBeNull();
  });
  it("rejects invalid required and email values", () => {
    expect(() => supplierName(" ")).toThrow();
    expect(() => supplierName("x".repeat(161))).toThrow();
    expect(() => supplierEmail("invalid")).toThrow();
    expect(() => supplierPhone("x".repeat(41))).toThrow();
  });
});
