BEGIN;

CREATE TABLE "branch_status_events" (
  "id" BIGSERIAL NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "status" "branch_status" NOT NULL,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "branch_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "branch_status_events_branch_effective_idx"
  ON "branch_status_events"("branch_id", "effective_at" DESC, "id" DESC);

ALTER TABLE "branch_status_events"
  ADD CONSTRAINT "branch_status_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "branch_status_events_branch_id_organization_id_fkey"
    FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Freeze Branch writes while the first trustworthy state is recorded.
LOCK TABLE "branches" IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO "branch_status_events" ("organization_id", "branch_id", "status", "effective_at")
SELECT "organization_id", "id", "status", statement_timestamp()
FROM "branches";

CREATE FUNCTION "record_branch_status_event"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "branch_status_events" ("organization_id", "branch_id", "status", "effective_at")
    VALUES (NEW."organization_id", NEW."id", NEW."status", NEW."created_at");
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NEW."updated_at" < (
      SELECT "effective_at" FROM "branch_status_events"
      WHERE "branch_id" = NEW."id"
      ORDER BY "effective_at" DESC, "id" DESC LIMIT 1
    ) THEN
      RAISE EXCEPTION 'branch status effective time cannot precede its history';
    END IF;
    INSERT INTO "branch_status_events" ("organization_id", "branch_id", "status", "effective_at")
    VALUES (NEW."organization_id", NEW."id", NEW."status", NEW."updated_at");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "branches_record_status_event"
  AFTER INSERT OR UPDATE OF "status" ON "branches"
  FOR EACH ROW EXECUTE FUNCTION "record_branch_status_event"();

CREATE FUNCTION "reject_branch_status_event_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'branch status history is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "branch_status_events_immutable"
  BEFORE UPDATE OR DELETE ON "branch_status_events"
  FOR EACH ROW EXECUTE FUNCTION "reject_branch_status_event_mutation"();

COMMIT;
