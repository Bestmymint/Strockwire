import { describe, expect, it } from "vitest";

import { Prisma } from "../generated/prisma/client.ts";
import { buildDemoFixture } from "./demo-fixture.ts";
import { demoDemand, demoId } from "./demo-values.ts";

describe("stockwise-demo-v1 fixed data", () => {
  it("keeps the DNS UUIDv5 identity and frozen demand counts", () => {
    expect(demoId("organization", "DEMO-ORGANIZATION")).toBe(
      "52c39044-b97a-528b-b181-9d6785c556a2",
    );
    let positiveWeeklyDays = 0;
    const monthly = new Map<string, number>();
    for (
      let date = new Date("2025-01-01T00:00:00.000Z");
      date < new Date("2026-09-26T00:00:00.000Z");
      date.setUTCDate(date.getUTCDate() + 1)
    ) {
      const local = date.toISOString().slice(0, 10);
      const demand = Number(demoDemand(local, "DEMO-A", "DEMO-WEEKLY"));
      if (demand > 0) positiveWeeklyDays += 1;
      monthly.set(
        local.slice(0, 7),
        (monthly.get(local.slice(0, 7)) ?? 0) + demand,
      );
    }
    expect(positiveWeeklyDays).toBe(484);
    expect([
      monthly.get("2025-11"),
      monthly.get("2025-12"),
      monthly.get("2026-01"),
    ]).toEqual([60, 107, 47]);
    expect(demoDemand("2026-09-25", "DEMO-B", "DEMO-SPARSE")).toBe("0");
  });

  it("builds the exact bounded lifecycle and nonnegative stock", async () => {
    const fixture = await buildDemoFixture("demo-only-credential-12345");
    expect([
      fixture.sales.length,
      fixture.payments.length,
      fixture.saleItems.length,
    ]).toEqual([1266, 1266, 2488]);
    expect([
      fixture.orders.length,
      fixture.receipts.length,
      fixture.receiptItems.length,
    ]).toEqual([43, 43, 108]);
    expect([
      fixture.refunds.length,
      fixture.refundItems.length,
      fixture.movements.length,
    ]).toEqual([1, 1, 2599]);
    expect(
      fixture.balances.every(
        (balance) => !new Prisma.Decimal(String(balance.quantity)).isNegative(),
      ),
    ).toBe(true);
  });
});
