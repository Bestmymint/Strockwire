import { describe, expect, it, vi } from "vitest";

import { createAnalyticsContextEngine } from "./analytics-context.ts";
import type { AnalyticsScopeRepository } from "./analytics-scope-repository.ts";

describe("analytics context engine", () => {
  it("combines one server cutoff with persisted timezone and authorized scope", async () => {
    const sourceCutoff = new Date("2026-09-20T12:34:56.789Z");
    const now = vi.fn(() => sourceCutoff);
    const scopeRepository: AnalyticsScopeRepository = {
      resolve: vi.fn(async () => ({
        kind: "success" as const,
        reportingTimezone: "Asia/Bangkok",
        scope: {
          branchCount: 1,
          branchIds: ["branch-a"],
          canViewCost: true,
          kind: "organization" as const,
          organizationId: "organization-a",
        },
      })),
    };
    const engine = createAnalyticsContextEngine({ now, scopeRepository });

    const outcome = await engine.resolve({
      actorUserId: "user-a",
      analyticsKind: "business",
      from: "2026-09-20",
      granularity: "day",
      organizationId: "organization-a",
      scope: { kind: "organization" },
      to: "2026-09-21",
    });

    expect(now).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({
      context: {
        period: {
          metricDefinitionVersion: "analytics-v1",
          reportingTimezone: "Asia/Bangkok",
          sourceCutoff,
        },
        scope: { branchIds: ["branch-a"] },
      },
      kind: "success",
    });
  });

  it("returns authorization/configuration failures without building a period", async () => {
    const scopeRepository: AnalyticsScopeRepository = {
      resolve: vi.fn(async () => ({ kind: "forbidden" as const })),
    };
    const engine = createAnalyticsContextEngine({
      now: () => new Date("2026-09-20T00:00:00.000Z"),
      scopeRepository,
    });

    await expect(
      engine.resolve({
        actorUserId: "user-a",
        analyticsKind: "business",
        from: "not-a-date",
        granularity: "day",
        organizationId: "organization-a",
        scope: { kind: "organization" },
        to: "also-not-a-date",
      }),
    ).resolves.toEqual({ kind: "forbidden" });
  });
});
