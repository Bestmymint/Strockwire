import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../../prisma/migrations/20260920120000_add_organization_reporting_timezone/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Organization reporting timezone schema", () => {
  it("adds one required Organization field with the accepted default", () => {
    expect(schema).toMatch(
      /reportingTimezone\s+String\s+@default\("Asia\/Bangkok"\)\s+@map\("reporting_timezone"\)\s+@db\.VarChar\(255\)/,
    );
    expect(migration).toMatch(
      /ALTER TABLE "organizations"[\s\S]*ADD COLUMN "reporting_timezone" VARCHAR\(255\) NOT NULL DEFAULT 'Asia\/Bangkok'/,
    );
  });

  it("does not add Branch timezone or rewrite operational timestamps", () => {
    expect(migration).not.toMatch(/ALTER TABLE "branches"/);
    expect(migration).not.toMatch(
      /UPDATE\s+"?(sales|sale_refunds|purchase_receipts|inventory_transactions)"?/i,
    );
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
