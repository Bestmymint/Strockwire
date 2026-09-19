import { describe, expect, it } from "vitest";

import {
  analyticsPeriodSelectorSchema,
  analyticsScopeSelectorSchema,
} from "./analytics-schemas.ts";

describe("analytics selector schemas", () => {
  it("accepts only strict date-only selectors and known granularities", () => {
    expect(
      analyticsPeriodSelectorSchema.parse({
        from: "2026-09-20",
        granularity: "day",
        to: "2026-09-21",
      }),
    ).toEqual({
      from: "2026-09-20",
      granularity: "day",
      to: "2026-09-21",
    });
    expect(
      analyticsPeriodSelectorSchema.safeParse({
        from: "2026-09-20T00:00:00Z",
        granularity: "day",
        to: "2026-09-21",
      }).success,
    ).toBe(false);
    expect(
      analyticsPeriodSelectorSchema.safeParse({
        from: "2026-09-20",
        granularity: "quarter",
        to: "2026-09-21",
      }).success,
    ).toBe(false);
  });

  it("requires a Branch ID only for Branch scope", () => {
    const branchId = "11111111-1111-4111-8111-111111111111";
    expect(
      analyticsScopeSelectorSchema.parse({
        branchId,
        scope: "branch",
      }),
    ).toEqual({
      scope: { branchId, kind: "branch" },
    });
    expect(
      analyticsScopeSelectorSchema.safeParse({
        scope: "branch",
      }).success,
    ).toBe(false);
    expect(
      analyticsScopeSelectorSchema.safeParse({
        branchId,
        scope: "organization",
      }).success,
    ).toBe(false);
  });
});
