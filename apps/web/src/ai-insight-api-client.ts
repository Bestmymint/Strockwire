import { z } from "zod";
import { privateFetch, readPrivateJson } from "@/session-lifecycle";

const insightSchema = z.object({
  cadence: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  reportingTimezone: z.string(),
  periodStartInclusive: z.string().datetime(),
  periodEndExclusive: z.string().datetime(),
  state: z.enum(["SUCCEEDED", "FAILED", "INSUFFICIENT", "IN_PROGRESS"]),
  content: z.string().nullable(),
  completedAt: z.string().datetime().nullable(),
});

const latestResponseSchema = z.object({
  data: z.object({
    latest: insightSchema.nullable(),
    lastSuccess: insightSchema.nullable(),
    stale: z.boolean(),
  }),
});

export type InsightCadence = z.infer<typeof insightSchema>["cadence"];
export type InsightScope =
  { scope: "organization" } | { scope: "branch"; branchId: string };

export class InsightApiError extends Error {
  constructor(readonly status: number) {
    super("Insight read failed");
  }
}

export async function getLatestInsight(
  organizationId: string,
  scope: InsightScope,
  cadence: InsightCadence,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ scope: scope.scope, cadence });
  if (scope.scope === "branch") params.set("branchId", scope.branchId);
  let response: Response;
  try {
    response = await privateFetch(
      `/api/v1/organizations/${organizationId}/ai-insights/latest?${params}`,
      {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        ...(signal ? { signal } : {}),
      },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new InsightApiError(0);
  }
  if (!response.ok) throw new InsightApiError(response.status);
  try {
    return latestResponseSchema.parse(await readPrivateJson(response)).data;
  } catch {
    throw new InsightApiError(0);
  }
}
