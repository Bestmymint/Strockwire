import { describe, expect, it } from "vitest";

import { analyticsSnapshotPayloadSchema } from "./analytics-snapshot-store.ts";

describe("analytics snapshot payload", () => {
  it("accepts zero facts, keeps unavailable cost null, and rejects unlisted fields", () => {
    const payload = {
      sales: {
        saleCount: 0,
        refundCount: 0,
        netSalesAmount: "0.00",
        refundAmount: "0.00",
        averageOrderValue: { value: null, reason: "NO_SALES" },
        netSalesGrowthPercent: { value: "0.00", reason: null },
        costCoverage: "none",
        grossProfitAmount: {
          value: null,
          reason: "INCOMPLETE_COST_COVERAGE",
        },
        grossMarginPercent: {
          value: null,
          reason: "INCOMPLETE_COST_COVERAGE",
        },
      },
    };
    const parsed = analyticsSnapshotPayloadSchema.parse(payload);
    expect(parsed.sales.netSalesAmount).toBe("0.00");
    expect(parsed.sales.grossProfitAmount.value).toBeNull();
    expect(() =>
      analyticsSnapshotPayloadSchema.parse({
        sales: { ...payload.sales, userId: "private" },
      }),
    ).toThrow();
    expect(() =>
      analyticsSnapshotPayloadSchema.parse({
        sales: {
          ...payload.sales,
          grossProfitAmount: {
            value: "0.0000000000",
            reason: "INCOMPLETE_COST_COVERAGE",
          },
        },
      }),
    ).toThrow();
  });
});
