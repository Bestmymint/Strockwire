import { describe, expect, it, vi } from "vitest";

import type { AnalyticsContextEngine } from "./analytics-context.ts";
import type { AnalyticsSalesRepository } from "./analytics-sales-repository.ts";
import { createAnalyticsSalesService } from "./analytics-sales-service.ts";

const request = {
  actorUserId: "actor-id",
  from: "2026-09-20",
  granularity: "day" as const,
  organizationId: "organization-id",
  scope: { kind: "organization" as const },
  to: "2026-09-21",
};

describe("analytics sales service", () => {
  it("uses the existing business context engine before reading metrics", async () => {
    const context = {
      period: { metricDefinitionVersion: "analytics-v1" as const },
      scope: { branchIds: ["branch-id"] },
    };
    const resolve = vi.fn(async () => ({ kind: "success" as const, context }));
    const read = vi.fn(async () => ({
      buckets: [],
      context,
      metricDefinitionVersion: "analytics-v1" as const,
    }));
    const service = createAnalyticsSalesService({
      contextEngine: { resolve } as unknown as AnalyticsContextEngine,
      repository: { read } as unknown as AnalyticsSalesRepository,
    });

    await expect(service.read(request)).resolves.toMatchObject({
      kind: "success",
      metrics: { metricDefinitionVersion: "analytics-v1" },
    });
    expect(resolve).toHaveBeenCalledWith({
      ...request,
      analyticsKind: "business",
    });
    expect(read).toHaveBeenCalledWith(context);
  });

  it("fails closed without querying metrics when scope resolution is denied", async () => {
    const resolve = vi.fn(async () => ({ kind: "forbidden" as const }));
    const read = vi.fn();
    const service = createAnalyticsSalesService({
      contextEngine: { resolve } as unknown as AnalyticsContextEngine,
      repository: { read } as unknown as AnalyticsSalesRepository,
    });

    await expect(service.read(request)).resolves.toEqual({ kind: "forbidden" });
    expect(read).not.toHaveBeenCalled();
  });
});
