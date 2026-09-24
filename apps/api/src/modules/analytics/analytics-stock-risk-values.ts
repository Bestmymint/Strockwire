import { Prisma } from "../../generated/prisma/client.ts";
import type { InventoryNullableMetric } from "./analytics-inventory-values.ts";

const STOCK_RISK_VERSION = "stock-risk-v1" as const;
const LOW_STOCK_MAX_DAYS = new Prisma.Decimal("7.00");
const OVERSTOCK_MIN_DAYS = new Prisma.Decimal("60.00");

type CoverageUnavailableReason =
  | "INSUFFICIENT_DATA"
  | "NO_RECENT_DEMAND"
  | "NO_STOCK_AND_NO_DEMAND"
  | "INVENTORY_INTEGRITY_ERROR";

export type InventoryStockClassification =
  | Readonly<{
      classification: "LOW_STOCK" | "NORMAL" | "OVERSTOCK";
      reason: null;
      thresholdVersion: typeof STOCK_RISK_VERSION;
    }>
  | Readonly<{
      classification: null;
      reason: CoverageUnavailableReason | "INACTIVE_PRODUCT";
      thresholdVersion: typeof STOCK_RISK_VERSION;
    }>;

export function classifyInventoryStock(
  coverageDays: InventoryNullableMetric,
  productStatus: "ACTIVE" | "INACTIVE",
): InventoryStockClassification {
  if (productStatus === "INACTIVE") {
    return {
      classification: null,
      reason: "INACTIVE_PRODUCT",
      thresholdVersion: STOCK_RISK_VERSION,
    };
  }

  if (coverageDays.value === null) {
    switch (coverageDays.reason) {
      case "INSUFFICIENT_DATA":
      case "NO_RECENT_DEMAND":
      case "NO_STOCK_AND_NO_DEMAND":
      case "INVENTORY_INTEGRITY_ERROR":
        return {
          classification: null,
          reason: coverageDays.reason,
          thresholdVersion: STOCK_RISK_VERSION,
        };
      default:
        throw new Error("Inventory coverage is missing an accepted reason.");
    }
  }
  if (coverageDays.reason !== null) {
    throw new Error(
      "Inventory coverage has a value and an unavailable reason.",
    );
  }

  const coverage = new Prisma.Decimal(coverageDays.value);
  return {
    classification: coverage.lte(LOW_STOCK_MAX_DAYS)
      ? "LOW_STOCK"
      : coverage.gte(OVERSTOCK_MIN_DAYS)
        ? "OVERSTOCK"
        : "NORMAL",
    reason: null,
    thresholdVersion: STOCK_RISK_VERSION,
  };
}
