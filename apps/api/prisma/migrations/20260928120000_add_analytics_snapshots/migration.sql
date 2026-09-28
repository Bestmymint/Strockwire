CREATE TYPE "analytics_snapshot_scope" AS ENUM ('ORGANIZATION', 'BRANCH');
CREATE TYPE "analytics_snapshot_cadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

CREATE TABLE "analytics_snapshots" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID,
  "scope" "analytics_snapshot_scope" NOT NULL,
  "scope_key" VARCHAR(36) NOT NULL,
  "cadence" "analytics_snapshot_cadence" NOT NULL,
  "reporting_timezone" VARCHAR(255) NOT NULL,
  "local_from_inclusive" VARCHAR(10) NOT NULL,
  "local_to_exclusive" VARCHAR(10) NOT NULL,
  "period_start_inclusive" TIMESTAMPTZ(3) NOT NULL,
  "period_end_exclusive" TIMESTAMPTZ(3) NOT NULL,
  "schema_version" VARCHAR(64) NOT NULL,
  "metric_definition_version" VARCHAR(64) NOT NULL,
  "source_cutoff" TIMESTAMPTZ(3) NOT NULL,
  "data_status" VARCHAR(16) NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_snapshots_scope_check" CHECK (
    ("scope" = 'ORGANIZATION' AND "branch_id" IS NULL AND "scope_key" = 'organization') OR
    ("scope" = 'BRANCH' AND "branch_id" IS NOT NULL AND "scope_key" = "branch_id"::text)
  ),
  CONSTRAINT "analytics_snapshots_period_check" CHECK (
    "period_start_inclusive" < "period_end_exclusive" AND
    "period_end_exclusive" <= "source_cutoff" AND
    "local_from_inclusive" < "local_to_exclusive"
  ),
  CONSTRAINT "analytics_snapshots_data_status_check" CHECK ("data_status" = 'complete')
);

CREATE UNIQUE INDEX "analytics_snapshots_identity_key" ON "analytics_snapshots"("organization_id", "scope_key", "cadence", "reporting_timezone", "period_start_inclusive", "period_end_exclusive", "schema_version", "metric_definition_version");
CREATE INDEX "analytics_snapshots_scope_period_idx" ON "analytics_snapshots"("organization_id", "branch_id", "cadence", "period_end_exclusive");

ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION reject_analytics_snapshot_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'analytics snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER analytics_snapshots_immutable BEFORE UPDATE ON "analytics_snapshots"
FOR EACH ROW EXECUTE FUNCTION reject_analytics_snapshot_update();
