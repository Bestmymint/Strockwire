import { Temporal } from "@js-temporal/polyfill";

export const ANALYTICS_GRANULARITIES = [
  "day",
  "week",
  "month",
  "year",
] as const;

export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number];
export type AnalyticsBaseDataStatus = "complete" | "partial";

export type AnalyticsPeriodErrorCode =
  | "INVALID_LOCAL_DATE"
  | "INVALID_RANGE"
  | "INVALID_SOURCE_CUTOFF"
  | "INVALID_TIMEZONE"
  | "RANGE_TOO_LARGE"
  | "UNALIGNED_RANGE";

export class AnalyticsPeriodError extends Error {
  readonly code: AnalyticsPeriodErrorCode;

  constructor(code: AnalyticsPeriodErrorCode, message: string) {
    super(message);
    this.name = "AnalyticsPeriodError";
    this.code = code;
  }
}

export interface AnalyticsPeriodBucket {
  bucketEndExclusive: Date;
  bucketStartInclusive: Date;
  dataStatus: AnalyticsBaseDataStatus;
  label: string;
  localEndExclusive: string;
  localStartInclusive: string;
}

export interface AnalyticsPeriodContext {
  buckets: readonly AnalyticsPeriodBucket[];
  dataStatus: AnalyticsBaseDataStatus;
  from: string;
  granularity: AnalyticsGranularity;
  metricDefinitionVersion: "analytics-v1";
  periodEndExclusive: Date;
  periodStartInclusive: Date;
  reportingTimezone: string;
  sourceCutoff: Date;
  to: string;
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LOCAL_DATE_SPAN = 366;

function parseLocalDate(value: string): Temporal.PlainDate {
  if (!LOCAL_DATE_PATTERN.test(value)) {
    throw new AnalyticsPeriodError(
      "INVALID_LOCAL_DATE",
      "Analytics dates must use YYYY-MM-DD.",
    );
  }

  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" });
  } catch {
    throw new AnalyticsPeriodError(
      "INVALID_LOCAL_DATE",
      "Analytics dates must be valid ISO calendar dates.",
    );
  }
}

export function validateIanaTimeZone(timeZone: string): string {
  if (timeZone.length === 0 || timeZone.trim() !== timeZone) {
    throw new AnalyticsPeriodError(
      "INVALID_TIMEZONE",
      "The persisted reporting timezone is invalid.",
    );
  }

  try {
    const resolvedTimeZone = new Intl.DateTimeFormat("en-US", {
      timeZone,
    }).resolvedOptions().timeZone;
    if (/^[+-]\d{2}:\d{2}$/.test(resolvedTimeZone)) {
      throw new RangeError("Fixed offsets are not IANA timezone identifiers.");
    }
  } catch {
    throw new AnalyticsPeriodError(
      "INVALID_TIMEZONE",
      "The persisted reporting timezone is invalid.",
    );
  }

  return timeZone;
}

export function localDateToUtcBoundary(
  localDate: string,
  reportingTimezone: string,
): Date {
  const date = parseLocalDate(localDate);
  const timeZone = validateIanaTimeZone(reportingTimezone);

  try {
    const boundary = date.toZonedDateTime({
      plainTime: "00:00",
      timeZone,
    });
    if (!boundary.toPlainDate().equals(date)) {
      throw new RangeError("The local calendar date does not exist.");
    }

    return new Date(boundary.epochMilliseconds);
  } catch {
    throw new AnalyticsPeriodError(
      "INVALID_LOCAL_DATE",
      "The local reporting date does not exist in the reporting timezone.",
    );
  }
}

export function captureAnalyticsSourceCutoff(
  now: () => Date = () => new Date(),
): Date {
  const sourceCutoff = now();

  if (Number.isNaN(sourceCutoff.getTime())) {
    throw new AnalyticsPeriodError(
      "INVALID_SOURCE_CUTOFF",
      "The analytics source cutoff must be a valid UTC instant.",
    );
  }

  return new Date(sourceCutoff.getTime());
}

function assertAligned(
  date: Temporal.PlainDate,
  granularity: AnalyticsGranularity,
): void {
  const aligned =
    granularity === "day" ||
    (granularity === "week" && date.dayOfWeek === 1) ||
    (granularity === "month" && date.day === 1) ||
    (granularity === "year" && date.month === 1 && date.day === 1);

  if (!aligned) {
    throw new AnalyticsPeriodError(
      "UNALIGNED_RANGE",
      `Analytics ${granularity} boundaries are not aligned.`,
    );
  }
}

function nextDate(
  date: Temporal.PlainDate,
  granularity: AnalyticsGranularity,
): Temporal.PlainDate {
  switch (granularity) {
    case "day":
      return date.add({ days: 1 });
    case "week":
      return date.add({ weeks: 1 });
    case "month":
      return date.add({ months: 1 });
    case "year":
      return date.add({ years: 1 });
  }
}

export function previousDate(
  date: Temporal.PlainDate,
  granularity: AnalyticsGranularity,
): Temporal.PlainDate {
  switch (granularity) {
    case "day":
      return date.subtract({ days: 1 });
    case "week":
      return date.subtract({ weeks: 1 });
    case "month":
      return date.subtract({ months: 1 });
    case "year":
      return date.subtract({ years: 1 });
  }
}

function bucketLabel(
  date: Temporal.PlainDate,
  granularity: AnalyticsGranularity,
): string {
  if (granularity === "month") {
    return date.toString().slice(0, 7);
  }

  if (granularity === "year") {
    return date.toString().slice(0, 4);
  }

  return date.toString();
}

function dataStatus(
  endExclusive: Date,
  sourceCutoff: Date,
): AnalyticsBaseDataStatus {
  return endExclusive.getTime() <= sourceCutoff.getTime()
    ? "complete"
    : "partial";
}

export function createAnalyticsPeriodContext(input: {
  from: string;
  granularity: AnalyticsGranularity;
  reportingTimezone: string;
  sourceCutoff: Date;
  to: string;
}): AnalyticsPeriodContext {
  const fromDate = parseLocalDate(input.from);
  const toDate = parseLocalDate(input.to);
  const reportingTimezone = validateIanaTimeZone(input.reportingTimezone);
  const sourceCutoff = captureAnalyticsSourceCutoff(() => input.sourceCutoff);

  if (Temporal.PlainDate.compare(fromDate, toDate) >= 0) {
    throw new AnalyticsPeriodError(
      "INVALID_RANGE",
      "Analytics from must be earlier than to.",
    );
  }

  const localDateSpan = fromDate.until(toDate, { largestUnit: "day" }).days;
  if (localDateSpan > MAX_LOCAL_DATE_SPAN) {
    throw new AnalyticsPeriodError(
      "RANGE_TOO_LARGE",
      "Analytics ranges may contain at most 366 local dates.",
    );
  }

  assertAligned(fromDate, input.granularity);
  assertAligned(toDate, input.granularity);

  const buckets: AnalyticsPeriodBucket[] = [];
  let bucketStart = fromDate;

  while (Temporal.PlainDate.compare(bucketStart, toDate) < 0) {
    const bucketEnd = nextDate(bucketStart, input.granularity);
    const bucketStartInclusive = localDateToUtcBoundary(
      bucketStart.toString(),
      reportingTimezone,
    );
    const bucketEndExclusive = localDateToUtcBoundary(
      bucketEnd.toString(),
      reportingTimezone,
    );

    buckets.push({
      bucketEndExclusive,
      bucketStartInclusive,
      dataStatus: dataStatus(bucketEndExclusive, sourceCutoff),
      label: bucketLabel(bucketStart, input.granularity),
      localEndExclusive: bucketEnd.toString(),
      localStartInclusive: bucketStart.toString(),
    });
    bucketStart = bucketEnd;
  }

  const firstBucket = buckets[0];
  const lastBucket = buckets.at(-1);
  if (firstBucket === undefined || lastBucket === undefined) {
    throw new AnalyticsPeriodError(
      "INVALID_RANGE",
      "Analytics periods must contain at least one bucket.",
    );
  }

  return Object.freeze({
    buckets: Object.freeze(buckets),
    dataStatus: dataStatus(lastBucket.bucketEndExclusive, sourceCutoff),
    from: fromDate.toString(),
    granularity: input.granularity,
    metricDefinitionVersion: "analytics-v1" as const,
    periodEndExclusive: new Date(lastBucket.bucketEndExclusive.getTime()),
    periodStartInclusive: new Date(firstBucket.bucketStartInclusive.getTime()),
    reportingTimezone,
    sourceCutoff,
    to: toDate.toString(),
  });
}

export function createAnalyticsComparisonBucket(
  period: AnalyticsPeriodContext,
): AnalyticsPeriodBucket {
  const localEnd = parseLocalDate(period.from);
  const localStart = previousDate(localEnd, period.granularity);
  const bucketStartInclusive = localDateToUtcBoundary(
    localStart.toString(),
    period.reportingTimezone,
  );
  const bucketEndExclusive = localDateToUtcBoundary(
    localEnd.toString(),
    period.reportingTimezone,
  );

  return Object.freeze({
    bucketEndExclusive,
    bucketStartInclusive,
    dataStatus: dataStatus(bucketEndExclusive, period.sourceCutoff),
    label: bucketLabel(localStart, period.granularity),
    localEndExclusive: localEnd.toString(),
    localStartInclusive: localStart.toString(),
  });
}
