import { describe, expect, it } from "vitest";

import { dueAiInsightPeriods } from "./ai-insight-cadence.ts";

const due = (instant: string, timeZone = "Asia/Bangkok") =>
  dueAiInsightPeriods(new Date(instant), timeZone);

describe("AI insight cadence", () => {
  it.each([
    ["day", "2026-09-20T22:59:59.999Z", "2026-09-19", "2026-09-20"],
    ["day", "2026-09-20T23:00:00.000Z", "2026-09-20", "2026-09-21"],
    ["day", "2026-09-20T23:00:00.001Z", "2026-09-20", "2026-09-21"],
    ["week", "2026-09-20T22:59:59.999Z", "2026-09-07", "2026-09-14"],
    ["week", "2026-09-20T23:00:00.000Z", "2026-09-14", "2026-09-21"],
    ["week", "2026-09-20T23:00:00.001Z", "2026-09-14", "2026-09-21"],
    ["month", "2026-09-30T22:59:59.999Z", "2026-08-01", "2026-09-01"],
    ["month", "2026-09-30T23:00:00.000Z", "2026-09-01", "2026-10-01"],
    ["month", "2026-09-30T23:00:00.001Z", "2026-09-01", "2026-10-01"],
    ["year", "2026-12-31T22:59:59.999Z", "2025-01-01", "2026-01-01"],
    ["year", "2026-12-31T23:00:00.000Z", "2026-01-01", "2027-01-01"],
    ["year", "2026-12-31T23:00:00.001Z", "2026-01-01", "2027-01-01"],
  ] as const)(
    "%s at %s selects completed %s to %s",
    (granularity, now, from, to) => {
      const periods = due(now).filter(
        (candidate) => candidate.granularity === granularity,
      );
      expect(periods).toHaveLength(2);
      expect(periods[1]).toMatchObject({ from, to });
      expect(periods[0]?.to).toBe(from);
      expect(periods[0]!.dueInstant.getTime()).toBeLessThan(
        periods[1]!.dueInstant.getTime(),
      );
      expect(periods[1]!.dueInstant.getTime()).toBeLessThanOrEqual(
        new Date(now).getTime(),
      );
    },
  );

  it("uses one exact half-open Bangkok day and never offers a third catch-up period", () => {
    const periods = due("2026-09-20T23:00:00.000Z").filter(
      ({ granularity }) => granularity === "day",
    );
    expect(periods.map(({ from, to }) => [from, to])).toEqual([
      ["2026-09-19", "2026-09-20"],
      ["2026-09-20", "2026-09-21"],
    ]);
    expect(periods[1]?.periodStartInclusive.toISOString()).toBe(
      "2026-09-19T17:00:00.000Z",
    );
    expect(periods[1]?.periodEndExclusive.toISOString()).toBe(
      "2026-09-20T17:00:00.000Z",
    );
    expect(due("2026-09-20T23:00:00.000Z")).toEqual(
      due("2026-09-20T23:00:00.000Z"),
    );
  });

  it("honors the Organization timezone and DST period lengths", () => {
    const bangkok = due("2026-03-09T04:00:00Z").find(
      ({ granularity }) => granularity === "day",
    );
    const newYork = due("2026-03-09T10:00:00Z", "America/New_York").filter(
      ({ granularity }) => granularity === "day",
    )[1];
    expect(bangkok?.reportingTimezone).toBe("Asia/Bangkok");
    expect(newYork).toMatchObject({ from: "2026-03-08", to: "2026-03-09" });
    expect(
      newYork!.periodEndExclusive.getTime() -
        newYork!.periodStartInclusive.getTime(),
    ).toBe(23 * 60 * 60 * 1000);
    expect(newYork?.dueInstant.toISOString()).toBe("2026-03-09T10:00:00.000Z");
  });

  it("runs a nonexistent 06:00 at the first valid instant after a three-hour gap", () => {
    const before = due("2018-10-06T19:59:59.999Z", "Antarctica/Casey").filter(
      ({ granularity }) => granularity === "day",
    )[1];
    const at = due("2018-10-06T20:00:00.000Z", "Antarctica/Casey").filter(
      ({ granularity }) => granularity === "day",
    )[1];
    expect(before?.to).toBe("2018-10-06");
    expect(at).toMatchObject({ from: "2018-10-06", to: "2018-10-07" });
    expect(at?.dueInstant.toISOString()).toBe("2018-10-06T20:00:00.000Z");
  });

  it("uses only the earlier occurrence of a repeated 06:00", () => {
    const earlier = due("1969-09-29T19:00:00.000Z", "Pacific/Kwajalein").filter(
      ({ granularity }) => granularity === "day",
    )[1];
    const later = due("1969-09-30T18:00:00.000Z", "Pacific/Kwajalein").filter(
      ({ granularity }) => granularity === "day",
    )[1];
    expect(earlier).toMatchObject({ from: "1969-09-29", to: "1969-09-30" });
    expect(earlier?.dueInstant.toISOString()).toBe("1969-09-29T19:00:00.000Z");
    expect(later).toEqual(earlier);
  });

  it("uses calendar months and years across leap and year boundaries", () => {
    const periods = due("2024-03-31T23:00:00Z");
    expect(
      periods
        .filter(({ granularity }) => granularity === "month")
        .map(({ from, to }) => [from, to]),
    ).toEqual([
      ["2024-02-01", "2024-03-01"],
      ["2024-03-01", "2024-04-01"],
    ]);
    expect(
      due("2026-12-31T23:00:00Z")
        .filter(({ granularity }) => granularity === "year")
        .map(({ from, to }) => [from, to]),
    ).toEqual([
      ["2025-01-01", "2026-01-01"],
      ["2026-01-01", "2027-01-01"],
    ]);
  });
});
