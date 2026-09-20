import { describe, expect, it } from "vitest";

import {
  AnalyticsPeriodError,
  captureAnalyticsSourceCutoff,
  createAnalyticsComparisonBucket,
  createAnalyticsPeriodContext,
  localDateToUtcBoundary,
  validateIanaTimeZone,
} from "./analytics-period.ts";

const COMPLETE_CUTOFF = new Date("2030-01-01T00:00:00.000Z");

function period(input: {
  from: string;
  granularity: "day" | "week" | "month" | "year";
  reportingTimezone?: string;
  sourceCutoff?: Date;
  to: string;
}) {
  return createAnalyticsPeriodContext({
    reportingTimezone: "Asia/Bangkok",
    sourceCutoff: COMPLETE_CUTOFF,
    ...input,
  });
}

function expectPeriodError(
  callback: () => unknown,
  code: AnalyticsPeriodError["code"],
) {
  try {
    callback();
    throw new Error("Expected analytics period validation to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AnalyticsPeriodError);
    expect((error as AnalyticsPeriodError).code).toBe(code);
  }
}

describe("analytics period engine", () => {
  it("converts Asia/Bangkok local midnight to the exact UTC boundary", () => {
    expect(
      localDateToUtcBoundary("2026-09-20", "Asia/Bangkok").toISOString(),
    ).toBe("2026-09-19T17:00:00.000Z");
  });

  it("converts a negative-offset local midnight", () => {
    expect(
      localDateToUtcBoundary("2026-01-15", "America/Los_Angeles").toISOString(),
    ).toBe("2026-01-15T08:00:00.000Z");
  });

  it("creates a 23-hour spring-forward day", () => {
    const result = period({
      from: "2026-03-08",
      granularity: "day",
      reportingTimezone: "America/New_York",
      to: "2026-03-09",
    });

    expect(result.periodStartInclusive.toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(result.periodEndExclusive.toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
    expect(
      result.periodEndExclusive.getTime() -
        result.periodStartInclusive.getTime(),
    ).toBe(23 * 60 * 60 * 1000);
  });

  it("creates a 25-hour fall-back day", () => {
    const result = period({
      from: "2026-11-01",
      granularity: "day",
      reportingTimezone: "America/New_York",
      to: "2026-11-02",
    });

    expect(result.periodStartInclusive.toISOString()).toBe(
      "2026-11-01T04:00:00.000Z",
    );
    expect(result.periodEndExclusive.toISOString()).toBe(
      "2026-11-02T05:00:00.000Z",
    );
    expect(
      result.periodEndExclusive.getTime() -
        result.periodStartInclusive.getTime(),
    ).toBe(25 * 60 * 60 * 1000);
  });

  it("uses the first valid instant when a DST transition skips local midnight", () => {
    expect(
      localDateToUtcBoundary("2019-09-08", "America/Santiago").toISOString(),
    ).toBe("2019-09-08T04:00:00.000Z");
  });

  it("uses the earlier instant when a DST transition repeats local midnight", () => {
    expect(
      localDateToUtcBoundary("2020-11-01", "America/Havana").toISOString(),
    ).toBe("2020-11-01T04:00:00.000Z");
  });

  it("rejects a civil date skipped entirely by an IANA transition", () => {
    expectPeriodError(
      () => localDateToUtcBoundary("2011-12-30", "Pacific/Apia"),
      "INVALID_LOCAL_DATE",
    );
  });

  it("accepts a real leap day and rejects an impossible date", () => {
    expect(
      period({ from: "2024-02-29", granularity: "day", to: "2024-03-01" })
        .buckets[0]?.label,
    ).toBe("2024-02-29");
    expectPeriodError(
      () =>
        period({
          from: "2026-02-29",
          granularity: "day",
          to: "2026-03-01",
        }),
      "INVALID_LOCAL_DATE",
    );
  });

  it.each(["20/09/2026", "2026-9-20", "2026-09-20T00:00:00Z"])(
    "rejects malformed date-only input %s",
    (from) => {
      expectPeriodError(
        () => period({ from, granularity: "day", to: "2026-09-21" }),
        "INVALID_LOCAL_DATE",
      );
    },
  );

  it("rejects an invalid IANA timezone", () => {
    expectPeriodError(
      () => validateIanaTimeZone("Mars/Olympus"),
      "INVALID_TIMEZONE",
    );
    expectPeriodError(() => validateIanaTimeZone("+07:00"), "INVALID_TIMEZONE");
  });

  it("does not silently accept missing persisted timezone state", () => {
    expectPeriodError(() => validateIanaTimeZone(""), "INVALID_TIMEZONE");
  });

  it("rejects empty and reversed ranges", () => {
    expectPeriodError(
      () =>
        period({ from: "2026-09-20", granularity: "day", to: "2026-09-20" }),
      "INVALID_RANGE",
    );
    expectPeriodError(
      () =>
        period({ from: "2026-09-21", granularity: "day", to: "2026-09-20" }),
      "INVALID_RANGE",
    );
  });

  it("accepts exactly 366 local dates independent of DST elapsed hours", () => {
    const result = period({
      from: "2024-01-01",
      granularity: "day",
      reportingTimezone: "America/New_York",
      to: "2025-01-01",
    });

    expect(result.buckets).toHaveLength(366);
  });

  it("rejects more than 366 local dates", () => {
    expectPeriodError(
      () =>
        period({
          from: "2024-01-01",
          granularity: "day",
          to: "2025-01-02",
        }),
      "RANGE_TOO_LARGE",
    );
  });

  it("keeps adjacent day buckets contiguous without assuming 24 hours", () => {
    const result = period({
      from: "2026-03-07",
      granularity: "day",
      reportingTimezone: "America/New_York",
      to: "2026-03-10",
    });

    expect(result.buckets).toHaveLength(3);
    expect(result.buckets[0]?.bucketEndExclusive).toEqual(
      result.buckets[1]?.bucketStartInclusive,
    );
    expect(result.buckets[1]?.bucketEndExclusive).toEqual(
      result.buckets[2]?.bucketStartInclusive,
    );
  });

  it("uses Monday-aligned weeks across month and year boundaries", () => {
    const result = period({
      from: "2025-12-29",
      granularity: "week",
      to: "2026-01-12",
    });

    expect(result.buckets.map((bucket) => bucket.label)).toEqual([
      "2025-12-29",
      "2026-01-05",
    ]);
    expectPeriodError(
      () =>
        period({ from: "2026-01-01", granularity: "week", to: "2026-01-08" }),
      "UNALIGNED_RANGE",
    );
  });

  it("uses calendar months and leap-year February", () => {
    const result = period({
      from: "2024-01-01",
      granularity: "month",
      to: "2024-04-01",
    });

    expect(
      result.buckets.map((bucket) => [
        bucket.label,
        bucket.localStartInclusive,
        bucket.localEndExclusive,
      ]),
    ).toEqual([
      ["2024-01", "2024-01-01", "2024-02-01"],
      ["2024-02", "2024-02-01", "2024-03-01"],
      ["2024-03", "2024-03-01", "2024-04-01"],
    ]);
  });

  it("uses calendar years and stable machine labels", () => {
    const result = period({
      from: "2024-01-01",
      granularity: "year",
      to: "2025-01-01",
    });

    expect(result.buckets.map((bucket) => bucket.label)).toEqual(["2024"]);
    expect(result.buckets[0]?.localEndExclusive).toBe("2025-01-01");
  });

  it("rejects unaligned month and year boundaries instead of clipping or expanding", () => {
    expectPeriodError(
      () =>
        period({ from: "2026-01-02", granularity: "month", to: "2026-02-01" }),
      "UNALIGNED_RANGE",
    );
    expectPeriodError(
      () =>
        period({ from: "2026-02-01", granularity: "year", to: "2027-01-01" }),
      "UNALIGNED_RANGE",
    );
  });

  it("returns exact half-open UTC bounds in deterministic ascending order", () => {
    const result = period({
      from: "2026-09-20",
      granularity: "day",
      to: "2026-09-23",
    });

    expect(result.periodStartInclusive.toISOString()).toBe(
      "2026-09-19T17:00:00.000Z",
    );
    expect(result.periodEndExclusive.toISOString()).toBe(
      "2026-09-22T17:00:00.000Z",
    );
    expect(result.buckets.map((bucket) => bucket.label)).toEqual([
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
    ]);
  });

  it("does not depend on the server-local timezone", () => {
    const originalTimeZone = process.env.TZ;

    try {
      process.env.TZ = "UTC";
      const utcServer = period({
        from: "2026-09-20",
        granularity: "day",
        reportingTimezone: "Asia/Bangkok",
        to: "2026-09-21",
      });
      process.env.TZ = "Pacific/Honolulu";
      const honoluluServer = period({
        from: "2026-09-20",
        granularity: "day",
        reportingTimezone: "Asia/Bangkok",
        to: "2026-09-21",
      });

      expect(honoluluServer.periodStartInclusive).toEqual(
        utcServer.periodStartInclusive,
      );
      expect(honoluluServer.periodEndExclusive).toEqual(
        utcServer.periodEndExclusive,
      );
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
  });

  it("classifies completeness against one immutable source cutoff", () => {
    const result = period({
      from: "2026-09-20",
      granularity: "day",
      sourceCutoff: new Date("2026-09-20T12:00:00.000Z"),
      to: "2026-09-22",
    });

    expect(result.dataStatus).toBe("partial");
    expect(result.buckets.map((bucket) => bucket.dataStatus)).toEqual([
      "partial",
      "partial",
    ]);
    expect(result.sourceCutoff.toISOString()).toBe("2026-09-20T12:00:00.000Z");
  });

  it("marks fully ended buckets complete at the source cutoff", () => {
    const result = period({
      from: "2026-09-20",
      granularity: "day",
      sourceCutoff: new Date("2026-09-22T00:00:00.000Z"),
      to: "2026-09-22",
    });

    expect(result.dataStatus).toBe("complete");
    expect(result.buckets.map((bucket) => bucket.dataStatus)).toEqual([
      "complete",
      "complete",
    ]);
  });

  it("captures the source cutoff exactly once and rejects an invalid clock", () => {
    let calls = 0;
    const cutoff = captureAnalyticsSourceCutoff(() => {
      calls += 1;
      return new Date("2026-09-20T01:02:03.456Z");
    });

    expect(calls).toBe(1);
    expect(cutoff.toISOString()).toBe("2026-09-20T01:02:03.456Z");
    expectPeriodError(
      () => captureAnalyticsSourceCutoff(() => new Date(Number.NaN)),
      "INVALID_SOURCE_CUTOFF",
    );
  });

  it("derives the immediately preceding canonical comparison bucket", () => {
    const context = period({
      from: "2026-03-08",
      granularity: "day",
      reportingTimezone: "America/New_York",
      sourceCutoff: new Date("2026-03-09T04:00:00.000Z"),
      to: "2026-03-09",
    });

    const comparison = createAnalyticsComparisonBucket(context);

    expect(comparison).toMatchObject({
      dataStatus: "complete",
      label: "2026-03-07",
      localEndExclusive: "2026-03-08",
      localStartInclusive: "2026-03-07",
    });
    expect(comparison.bucketStartInclusive.toISOString()).toBe(
      "2026-03-07T05:00:00.000Z",
    );
    expect(comparison.bucketEndExclusive.toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
  });

  it("re-buckets the same UTC fact when the Organization timezone changes", () => {
    const fact = new Date("2026-09-20T02:00:00.000Z").getTime();
    const bangkok = period({
      from: "2026-09-20",
      granularity: "day",
      reportingTimezone: "Asia/Bangkok",
      to: "2026-09-21",
    }).buckets[0];
    const newYork = period({
      from: "2026-09-19",
      granularity: "day",
      reportingTimezone: "America/New_York",
      to: "2026-09-20",
    }).buckets[0];

    expect(bangkok?.label).toBe("2026-09-20");
    expect(newYork?.label).toBe("2026-09-19");
    expect(fact).toBeGreaterThanOrEqual(
      bangkok?.bucketStartInclusive.getTime() ?? 0,
    );
    expect(fact).toBeLessThan(bangkok?.bucketEndExclusive.getTime() ?? 0);
    expect(fact).toBeGreaterThanOrEqual(
      newYork?.bucketStartInclusive.getTime() ?? 0,
    );
    expect(fact).toBeLessThan(newYork?.bucketEndExclusive.getTime() ?? 0);
  });
});
