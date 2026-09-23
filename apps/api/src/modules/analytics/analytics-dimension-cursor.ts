import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { AnalyticsExecutionContext } from "./analytics-context.ts";

export type AnalyticsDimension = "category" | "branch" | "inventory";

export class InvalidAnalyticsCursorError extends Error {
  readonly code = "INVALID_CURSOR";

  constructor() {
    super("The analytics cursor is invalid for this request.");
  }
}

const cursorSchema = z
  .object({
    branchSetDigest: z.string().regex(/^[0-9a-f]{64}$/),
    dimension: z.enum(["category", "branch", "inventory"]),
    from: z.string(),
    granularity: z.enum(["day", "week", "month", "year"]),
    lastId: z.string().uuid().nullable(),
    lastBranchId: z.string().uuid().optional(),
    lastProductId: z.string().uuid().optional(),
    dimensionContract: z.literal("inventory-branch-product-v1").optional(),
    metricDefinitionVersion: z.literal("analytics-v1"),
    ordering: z.enum([
      "category-id-asc-uncategorized-last",
      "branch-id-asc",
      "branch-id-product-id-asc",
    ]),
    organizationId: z.string().uuid(),
    periodEndExclusive: z.string().datetime({ offset: true }),
    periodStartInclusive: z.string().datetime({ offset: true }),
    reportingTimezone: z.string(),
    sourceCutoff: z.string().datetime({ offset: true }),
    to: z.string(),
    version: z.literal(1),
  })
  .strict();

type CursorPayload = z.infer<typeof cursorSchema>;

function ordering(dimension: AnalyticsDimension): CursorPayload["ordering"] {
  return dimension === "category"
    ? "category-id-asc-uncategorized-last"
    : dimension === "branch"
      ? "branch-id-asc"
      : "branch-id-product-id-asc";
}

function branchSetDigest(branchIds: readonly string[]): string {
  return createHash("sha256").update(branchIds.join("\n")).digest("hex");
}

export function assertAnalyticsDimensionCursor(
  payload: CursorPayload,
  context: AnalyticsExecutionContext,
): void {
  if (
    payload.metricDefinitionVersion !==
      context.period.metricDefinitionVersion ||
    payload.organizationId !== context.scope.organizationId ||
    payload.reportingTimezone !== context.period.reportingTimezone ||
    payload.periodStartInclusive !==
      context.period.periodStartInclusive.toISOString() ||
    payload.periodEndExclusive !==
      context.period.periodEndExclusive.toISOString() ||
    payload.from !== context.period.from ||
    payload.to !== context.period.to ||
    payload.granularity !== context.period.granularity ||
    payload.sourceCutoff !== context.period.sourceCutoff.toISOString() ||
    payload.branchSetDigest !== branchSetDigest(context.scope.branchIds) ||
    (payload.dimension === "inventory" &&
      (payload.dimensionContract !== "inventory-branch-product-v1" ||
        payload.lastBranchId === undefined ||
        payload.lastProductId === undefined))
  ) {
    throw new InvalidAnalyticsCursorError();
  }
}

export function createAnalyticsDimensionCursorCodec(secret: Uint8Array) {
  if (secret.byteLength < 32) {
    throw new Error("Analytics cursor signing key must be at least 32 bytes.");
  }
  const key = Buffer.from(secret);
  return Object.freeze({
    encode(
      input: { context: AnalyticsExecutionContext } & (
        | {
            dimension: "inventory";
            lastId: null;
            lastBranchId: string;
            lastProductId: string;
          }
        | { dimension: "category" | "branch"; lastId: string | null }
      ),
    ): string {
      const payload: CursorPayload = {
        branchSetDigest: branchSetDigest(input.context.scope.branchIds),
        dimension: input.dimension,
        from: input.context.period.from,
        granularity: input.context.period.granularity,
        lastId: input.lastId,
        ...(input.dimension === "inventory"
          ? {
              dimensionContract: "inventory-branch-product-v1" as const,
              lastBranchId: input.lastBranchId,
              lastProductId: input.lastProductId,
            }
          : {}),
        metricDefinitionVersion: input.context.period.metricDefinitionVersion,
        ordering: ordering(input.dimension),
        organizationId: input.context.scope.organizationId,
        periodEndExclusive:
          input.context.period.periodEndExclusive.toISOString(),
        periodStartInclusive:
          input.context.period.periodStartInclusive.toISOString(),
        reportingTimezone: input.context.period.reportingTimezone,
        sourceCutoff: input.context.period.sourceCutoff.toISOString(),
        to: input.context.period.to,
        version: 1,
      };
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const signature = createHmac("sha256", key)
        .update(body)
        .digest("base64url");
      return `${body}.${signature}`;
    },
    decode(cursor: string, dimension: AnalyticsDimension): CursorPayload {
      if (
        cursor.length === 0 ||
        cursor.length > 4096 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)
      ) {
        throw new InvalidAnalyticsCursorError();
      }
      try {
        const [body, signature] = cursor.split(".");
        if (body === undefined || signature === undefined)
          throw new Error("parts");
        const bytes = Buffer.from(body, "base64url");
        const suppliedSignature = Buffer.from(signature, "base64url");
        if (
          bytes.toString("base64url") !== body ||
          suppliedSignature.toString("base64url") !== signature
        )
          throw new Error("noncanonical");
        const expectedSignature = createHmac("sha256", key)
          .update(body)
          .digest();
        if (
          suppliedSignature.length !== expectedSignature.length ||
          !timingSafeEqual(suppliedSignature, expectedSignature)
        )
          throw new Error("signature");
        const payload = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
        if (
          payload.dimension !== dimension ||
          payload.ordering !== ordering(dimension)
        ) {
          throw new Error("dimension");
        }
        if (
          dimension === "inventory" &&
          (payload.dimensionContract !== "inventory-branch-product-v1" ||
            payload.lastId !== null ||
            payload.lastBranchId === undefined ||
            payload.lastProductId === undefined)
        )
          throw new Error("inventory dimension");
        if (
          dimension !== "inventory" &&
          (payload.dimensionContract !== undefined ||
            payload.lastBranchId !== undefined ||
            payload.lastProductId !== undefined)
        )
          throw new Error("unexpected dimension fields");
        const cutoff = new Date(payload.sourceCutoff);
        if (
          Number.isNaN(cutoff.getTime()) ||
          cutoff.toISOString() !== payload.sourceCutoff
        ) {
          throw new Error("cutoff");
        }
        return payload;
      } catch {
        throw new InvalidAnalyticsCursorError();
      }
    },
  });
}

export type AnalyticsDimensionCursorCodec = ReturnType<
  typeof createAnalyticsDimensionCursorCodec
>;

export function analyticsPageLimit(limit?: number): number {
  if (limit === undefined) return 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Analytics page limit must be between 1 and 100.");
  }
  return limit;
}
