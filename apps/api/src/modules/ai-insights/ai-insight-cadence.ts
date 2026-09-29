import { Temporal } from "@js-temporal/polyfill";

import {
  ANALYTICS_GRANULARITIES,
  captureAnalyticsSourceCutoff,
  createAnalyticsPeriodContext,
  previousDate,
  validateIanaTimeZone,
  type AnalyticsGranularity,
} from "../analytics/analytics-period.ts";

function scheduledDate(
  date: Temporal.PlainDate,
  granularity: AnalyticsGranularity,
): Temporal.PlainDate {
  switch (granularity) {
    case "day":
      return date;
    case "week":
      return date.subtract({ days: date.dayOfWeek - 1 });
    case "month":
      return date.with({ day: 1 });
    case "year":
      return date.with({ month: 1, day: 1 });
  }
}

function dueInstant(date: Temporal.PlainDate, timeZone: string): Date {
  const localDue = date.toPlainDateTime("06:00");
  const earlier = localDue.toZonedDateTime(timeZone, {
    disambiguation: "earlier",
  });
  if (earlier.toPlainDateTime().equals(localDue)) {
    return new Date(earlier.epochMilliseconds);
  }

  // A gap may span several hours: Temporal's "later" preserves 06:00's
  // minutes, while ADR-033 requires the first valid instant after the gap.
  const transition = earlier.getTimeZoneTransition("next");
  if (transition === null) {
    throw new Error("The scheduled local time has no valid due instant.");
  }
  return new Date(transition.epochMilliseconds);
}

export function dueAiInsightPeriods(now: Date, reportingTimezone: string) {
  const current = captureAnalyticsSourceCutoff(() => now);
  const timeZone = validateIanaTimeZone(reportingTimezone);
  const today = Temporal.Instant.fromEpochMilliseconds(current.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();

  return ANALYTICS_GRANULARITIES.flatMap((granularity) => {
    let latest = scheduledDate(today, granularity);
    if (dueInstant(latest, timeZone).getTime() > current.getTime()) {
      latest = previousDate(latest, granularity);
    }
    const older = previousDate(latest, granularity);
    return [older, latest].map((date) => {
      const from = previousDate(date, granularity).toString();
      const to = date.toString();
      const period = createAnalyticsPeriodContext({
        from,
        to,
        granularity,
        reportingTimezone: timeZone,
        sourceCutoff: current,
      });
      return {
        dueInstant: dueInstant(date, timeZone),
        from,
        granularity,
        periodEndExclusive: period.periodEndExclusive,
        periodStartInclusive: period.periodStartInclusive,
        reportingTimezone: timeZone,
        to,
      };
    });
  });
}
