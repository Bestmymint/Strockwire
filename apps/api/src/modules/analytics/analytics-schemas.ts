import { z } from "zod";

import { ANALYTICS_GRANULARITIES } from "./analytics-period.ts";

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const analyticsPeriodSelectorSchema = z
  .object({
    from: localDateSchema,
    granularity: z.enum(ANALYTICS_GRANULARITIES),
    to: localDateSchema,
  })
  .strict();

export const analyticsScopeSelectorSchema = z
  .discriminatedUnion("scope", [
    z
      .object({
        branchId: z.string().uuid(),
        scope: z.literal("branch"),
      })
      .strict(),
    z.object({ scope: z.literal("organization") }).strict(),
  ])
  .transform((value) => ({
    scope:
      value.scope === "branch"
        ? ({ branchId: value.branchId, kind: "branch" } as const)
        : ({ kind: "organization" } as const),
  }));
