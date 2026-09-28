CREATE TYPE "ai_insight_state" AS ENUM ('IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'INSUFFICIENT');
CREATE TYPE "ai_insight_failure_category" AS ENUM ('TIMEOUT', 'TRANSPORT', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'AUTHENTICATION', 'INVALID_REQUEST', 'INVALID_RESPONSE', 'PROVIDER_ERROR', 'INTERRUPTED');

CREATE UNIQUE INDEX "analytics_snapshots_id_organization_id_key" ON "analytics_snapshots"("id", "organization_id");

CREATE TABLE "ai_insight_reports" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID,
  "scope" "analytics_snapshot_scope" NOT NULL,
  "scope_key" VARCHAR(36) NOT NULL,
  "cadence" "analytics_snapshot_cadence" NOT NULL,
  "reporting_timezone" VARCHAR(255) NOT NULL,
  "period_start_inclusive" TIMESTAMPTZ(3) NOT NULL,
  "period_end_exclusive" TIMESTAMPTZ(3) NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "schema_version" VARCHAR(64) NOT NULL,
  "metric_definition_version" VARCHAR(64) NOT NULL,
  "source_cutoff" TIMESTAMPTZ(3) NOT NULL,
  "prompt_version" VARCHAR(64) NOT NULL,
  "state" "ai_insight_state" NOT NULL DEFAULT 'IN_PROGRESS',
  "claim_token" UUID,
  "claim_expires_at" TIMESTAMPTZ(3),
  "claimed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempt_count" INTEGER DEFAULT 0,
  "provider" VARCHAR(32),
  "actual_model" VARCHAR(128),
  "content" TEXT,
  "failure_category" "ai_insight_failure_category",
  "generated_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_insight_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_insight_reports_scope_check" CHECK (
    ("scope" = 'ORGANIZATION' AND "branch_id" IS NULL AND "scope_key" = 'organization') OR
    ("scope" = 'BRANCH' AND "branch_id" IS NOT NULL AND "scope_key" = "branch_id"::text)
  ),
  CONSTRAINT "ai_insight_reports_period_check" CHECK ("period_start_inclusive" < "period_end_exclusive" AND "period_end_exclusive" <= "source_cutoff"),
  CONSTRAINT "ai_insight_reports_count_check" CHECK ("attempt_count" IS NULL OR "attempt_count" BETWEEN 0 AND 3),
  CONSTRAINT "ai_insight_reports_provider_check" CHECK (
    "attempt_count" IS NULL OR
    ("attempt_count" = 0 AND "provider" IS NULL AND "actual_model" IS NULL) OR
    ("attempt_count" BETWEEN 1 AND 3 AND "provider" IS NOT NULL)
  ),
  CONSTRAINT "ai_insight_reports_result_check" CHECK (
    ("state" = 'IN_PROGRESS' AND "content" IS NULL AND "failure_category" IS NULL AND "completed_at" IS NULL AND "generated_at" IS NULL AND "claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL) OR
    ("state" = 'SUCCEEDED' AND "content" IS NOT NULL AND length(btrim("content")) > 0 AND octet_length("content") <= 4096 AND "failure_category" IS NULL AND "generated_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "claim_token" IS NULL AND "claim_expires_at" IS NULL AND "attempt_count" BETWEEN 1 AND 3 AND "provider" IS NOT NULL AND "actual_model" IS NOT NULL) OR
    ("state" = 'FAILED' AND "content" IS NULL AND "failure_category" IS NOT NULL AND "generated_at" IS NULL AND "completed_at" IS NOT NULL AND "claim_token" IS NULL AND "claim_expires_at" IS NULL) OR
    ("state" = 'INSUFFICIENT' AND "content" IS NULL AND "failure_category" IS NULL AND "generated_at" IS NULL AND "completed_at" IS NOT NULL AND "claim_token" IS NULL AND "claim_expires_at" IS NULL AND "attempt_count" = 0 AND "provider" IS NULL AND "actual_model" IS NULL)
  )
);

CREATE UNIQUE INDEX "ai_insight_reports_identity_key" ON "ai_insight_reports"("organization_id", "scope_key", "cadence", "reporting_timezone", "period_start_inclusive", "period_end_exclusive");
CREATE INDEX "ai_insight_reports_scope_period_idx" ON "ai_insight_reports"("organization_id", "branch_id", "cadence", "period_end_exclusive");
ALTER TABLE "ai_insight_reports" ADD CONSTRAINT "ai_insight_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_insight_reports" ADD CONSTRAINT "ai_insight_reports_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ai_insight_reports" ADD CONSTRAINT "ai_insight_reports_snapshot_id_organization_id_fkey" FOREIGN KEY ("snapshot_id", "organization_id") REFERENCES "analytics_snapshots"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "ai_insight_attempts" (
  "id" UUID NOT NULL,
  "report_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "requested_model" VARCHAR(128) NOT NULL,
  "actual_model" VARCHAR(128),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  "failure_category" "ai_insight_failure_category",
  "prompt_tokens" BIGINT,
  "completion_tokens" BIGINT,
  "total_tokens" BIGINT,
  "cost" VARCHAR(64),
  CONSTRAINT "ai_insight_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_insight_attempts_ordinal_check" CHECK ("ordinal" BETWEEN 1 AND 3),
  CONSTRAINT "ai_insight_attempts_times_check" CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at"),
  CONSTRAINT "ai_insight_attempts_pending_check" CHECK ("finished_at" IS NOT NULL OR ("actual_model" IS NULL AND "failure_category" IS NULL AND "prompt_tokens" IS NULL AND "completion_tokens" IS NULL AND "total_tokens" IS NULL AND "cost" IS NULL)),
  CONSTRAINT "ai_insight_attempts_usage_check" CHECK (
    ("prompt_tokens" IS NULL OR "prompt_tokens" >= 0) AND
    ("completion_tokens" IS NULL OR "completion_tokens" >= 0) AND
    ("total_tokens" IS NULL OR "total_tokens" >= 0) AND
    ("cost" IS NULL OR "cost" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$')
  )
);

CREATE UNIQUE INDEX "ai_insight_attempts_report_ordinal_key" ON "ai_insight_attempts"("report_id", "ordinal");
ALTER TABLE "ai_insight_attempts" ADD CONSTRAINT "ai_insight_attempts_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "ai_insight_reports"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION protect_ai_insight_report() RETURNS trigger AS $$
BEGIN
  IF OLD.state <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'terminal AI insight reports are immutable';
  END IF;
  IF (OLD.organization_id, OLD.branch_id, OLD.scope, OLD.scope_key, OLD.cadence,
      OLD.reporting_timezone, OLD.period_start_inclusive, OLD.period_end_exclusive,
      OLD.snapshot_id, OLD.schema_version, OLD.metric_definition_version,
      OLD.source_cutoff, OLD.prompt_version, OLD.created_at)
     IS DISTINCT FROM
     (NEW.organization_id, NEW.branch_id, NEW.scope, NEW.scope_key, NEW.cadence,
      NEW.reporting_timezone, NEW.period_start_inclusive, NEW.period_end_exclusive,
      NEW.snapshot_id, NEW.schema_version, NEW.metric_definition_version,
      NEW.source_cutoff, NEW.prompt_version, NEW.created_at) THEN
    RAISE EXCEPTION 'AI insight authority is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ai_insight_reports_protect BEFORE UPDATE ON "ai_insight_reports" FOR EACH ROW EXECUTE FUNCTION protect_ai_insight_report();

CREATE FUNCTION protect_ai_insight_attempt() RETURNS trigger AS $$
BEGIN
  IF OLD.finished_at IS NOT NULL OR
     (OLD.report_id, OLD.ordinal, OLD.provider, OLD.requested_model, OLD.started_at)
       IS DISTINCT FROM
     (NEW.report_id, NEW.ordinal, NEW.provider, NEW.requested_model, NEW.started_at) THEN
    RAISE EXCEPTION 'AI insight attempt provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ai_insight_attempts_protect BEFORE UPDATE ON "ai_insight_attempts" FOR EACH ROW EXECUTE FUNCTION protect_ai_insight_attempt();
