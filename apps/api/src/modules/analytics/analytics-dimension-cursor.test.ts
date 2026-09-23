import { createHmac, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { AnalyticsExecutionContext } from "./analytics-context.ts";
import {
  analyticsPageLimit,
  assertAnalyticsDimensionCursor,
  createAnalyticsDimensionCursorCodec,
} from "./analytics-dimension-cursor.ts";
import { createAnalyticsPeriodContext } from "./analytics-period.ts";

const branchA = "00000000-0000-4000-8000-000000000001";
const branchB = "00000000-0000-4000-8000-000000000002";
const organizationId = "00000000-0000-4000-8000-000000000003";
const key = Buffer.alloc(32, 1);
const codec = createAnalyticsDimensionCursorCodec(key);

function signedPayload(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

function context(): AnalyticsExecutionContext {
  return {
    period: createAnalyticsPeriodContext({
      from: "2026-09-20",
      granularity: "day",
      reportingTimezone: "Asia/Bangkok",
      sourceCutoff: new Date("2026-09-22T00:00:00.000Z"),
      to: "2026-09-22",
    }),
    scope: {
      branchCount: 2,
      branchIds: [branchA, branchB],
      canViewCost: true,
      kind: "organization",
      organizationId,
    },
  };
}

describe("analytics dimension cursor", () => {
  it("defaults to 25 and validates the bounded page size", () => {
    expect(analyticsPageLimit()).toBe(25);
    expect(analyticsPageLimit(100)).toBe(100);
    for (const value of [0, 101, 1.5, Number.NaN]) {
      expect(() => analyticsPageLimit(value)).toThrow(RangeError);
    }
  });

  it("binds dimension, organization, branch set, period and source cutoff", () => {
    const original = context();
    const encoded = codec.encode({
      context: original,
      dimension: "category",
      lastId: branchA,
    });
    const decoded = codec.decode(encoded, "category");
    expect(decoded.lastId).toBe(branchA);
    expect(() =>
      assertAnalyticsDimensionCursor(decoded, original),
    ).not.toThrow();
    expect(() => codec.decode(encoded, "branch")).toThrowError(/cursor/i);
    for (const altered of [
      { ...original, scope: { ...original.scope, organizationId: branchB } },
      { ...original, scope: { ...original.scope, branchIds: [branchA] } },
      { ...original, period: { ...original.period, from: "2026-09-19" } },
      {
        ...original,
        period: { ...original.period, granularity: "week" as const },
      },
      {
        ...original,
        period: {
          ...original.period,
          sourceCutoff: new Date("2026-09-23T00:00:00.000Z"),
        },
      },
      {
        ...original,
        period: { ...original.period, reportingTimezone: "UTC" },
      },
      {
        ...original,
        period: {
          ...original.period,
          periodStartInclusive: new Date("2026-09-19T16:00:00.000Z"),
        },
      },
    ]) {
      expect(() =>
        assertAnalyticsDimensionCursor(decoded, altered),
      ).toThrowError(/cursor/i);
    }
  });

  it("rejects malformed, unsupported-version and wrong-order cursors", () => {
    for (const cursor of ["?", "", "eyJ2ZXJzaW9uIjoyfQ"]) {
      expect(() => codec.decode(cursor, "category")).toThrowError(/cursor/i);
    }
    const valid = codec.encode({
      context: context(),
      dimension: "branch",
      lastId: branchA,
    });
    expect(() => codec.decode(valid, "category")).toThrowError(/cursor/i);
    const [payload] = valid.split(".");
    const body = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(() =>
      codec.decode(
        signedPayload({
          ...body,
          ordering: "category-id-asc-uncategorized-last",
        }),
        "branch",
      ),
    ).toThrowError(/cursor/i);
    expect(() =>
      codec.decode(signedPayload({ ...body, version: 2 }), "branch"),
    ).toThrowError(/cursor/i);
  });

  it("rejects a forged cutoff and a different signing key", () => {
    const valid = codec.encode({
      context: context(),
      dimension: "branch",
      lastId: branchA,
    });
    const [payload, signature] = valid.split(".");
    const body = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("branchIds");
    expect(body).not.toHaveProperty("cost");
    const forged = Buffer.from(
      JSON.stringify({ ...body, sourceCutoff: "2030-01-01T00:00:00.000Z" }),
    ).toString("base64url");
    expect(() => codec.decode(`${forged}.${signature}`, "branch")).toThrowError(
      /cursor/i,
    );
    const other = createAnalyticsDimensionCursorCodec(Buffer.alloc(32, 2));
    expect(() => other.decode(valid, "branch")).toThrowError(/cursor/i);
    expect(() =>
      createAnalyticsDimensionCursorCodec(Buffer.alloc(31)),
    ).toThrowError(/32 bytes/i);
  });

  it("keeps valid large Branch scopes within the cursor bound", () => {
    const original = context();
    const branchIds = Array.from({ length: 100 }, () => randomUUID()).sort();
    const expanded = {
      ...original,
      scope: { ...original.scope, branchCount: 100, branchIds },
    };
    const cursor = codec.encode({
      context: expanded,
      dimension: "branch",
      lastId: branchIds[0]!,
    });
    expect(cursor.length).toBeLessThan(4096);
    expect(() =>
      assertAnalyticsDimensionCursor(codec.decode(cursor, "branch"), expanded),
    ).not.toThrow();
  });
});
