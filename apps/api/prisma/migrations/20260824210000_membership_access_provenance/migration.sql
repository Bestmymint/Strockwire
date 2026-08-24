-- T03 requires a stable membership identifier for HTTP resources and
-- tenant-scoped invitation/access provenance. The existing composite primary
-- key remains the authoritative organization/user membership identity.
CREATE TYPE "invitation_revocation_reason" AS ENUM (
    'REPLACED',
    'CANCELLED',
    'DELIVERY_FAILED',
    'MEMBERSHIP_EXISTS'
);

CREATE TYPE "membership_access_event_type" AS ENUM (
    'INVITATION_ACCEPTED',
    'ROLE_SCOPE_REPLACED',
    'DEACTIVATED',
    'REACTIVATED'
);

ALTER TABLE "organization_memberships"
    ADD COLUMN "id" UUID,
    ADD COLUMN "source_invitation_id" UUID;

UPDATE "organization_memberships"
SET "id" = gen_random_uuid()
WHERE "id" IS NULL;

ALTER TABLE "organization_memberships"
    ALTER COLUMN "id" SET NOT NULL,
    ALTER COLUMN "id" DROP DEFAULT;

-- Invitation rows could not be created through the application before T03, so
-- no trustworthy issuer can be inferred for a pre-existing manual row. Fail
-- closed instead of fabricating provenance if such a row exists.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "invitations") THEN
        RAISE EXCEPTION 'T03 provenance migration cannot infer issuer for pre-existing invitation rows';
    END IF;
END $$;

ALTER TABLE "invitations"
    ADD COLUMN "issued_by_membership_id" UUID NOT NULL,
    ADD COLUMN "revoked_by_membership_id" UUID,
    ADD COLUMN "revocation_reason" "invitation_revocation_reason";

CREATE TABLE "membership_access_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "target_membership_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_membership_id" UUID,
    "event_type" "membership_access_event_type" NOT NULL,
    "before_role" "organization_role",
    "before_status" "membership_status",
    "after_role" "organization_role" NOT NULL,
    "after_status" "membership_status" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_access_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "membership_access_event_branch_scopes" (
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "membership_access_event_branch_scopes_pkey"
        PRIMARY KEY ("organization_id", "event_id", "branch_id")
);

CREATE UNIQUE INDEX "organization_memberships_organization_id_id_key"
    ON "organization_memberships"("organization_id", "id");

CREATE UNIQUE INDEX "organization_memberships_source_invitation_organization_key"
    ON "organization_memberships"("source_invitation_id", "organization_id");

CREATE UNIQUE INDEX "membership_access_events_id_organization_id_key"
    ON "membership_access_events"("id", "organization_id");

CREATE INDEX "membership_access_events_target_time_idx"
    ON "membership_access_events"("organization_id", "target_membership_id", "occurred_at");

CREATE INDEX "membership_access_events_actor_time_idx"
    ON "membership_access_events"("actor_user_id", "occurred_at");

CREATE INDEX "membership_access_event_branch_scopes_branch_organization_idx"
    ON "membership_access_event_branch_scopes"("branch_id", "organization_id");

ALTER TABLE "invitations"
    ADD CONSTRAINT "invitations_revocation_provenance_check" CHECK (
        (
            "consumed_at" IS NOT NULL
            AND "revocation_reason" IS NULL
            AND "revoked_by_membership_id" IS NULL
        )
        OR (
            "replaced_at" IS NOT NULL
            AND "revocation_reason" = 'REPLACED'
            AND "revoked_by_membership_id" IS NOT NULL
        )
        OR (
            "revoked_at" IS NOT NULL
            AND "revocation_reason" = 'CANCELLED'
            AND "revoked_by_membership_id" IS NOT NULL
        )
        OR (
            "revoked_at" IS NOT NULL
            AND "revocation_reason" = 'DELIVERY_FAILED'
            AND "revoked_by_membership_id" IS NULL
        )
        OR (
            "revoked_at" IS NOT NULL
            AND "revocation_reason" = 'MEMBERSHIP_EXISTS'
            AND "revoked_by_membership_id" IS NULL
        )
        OR (
            "consumed_at" IS NULL
            AND "revoked_at" IS NULL
            AND "replaced_at" IS NULL
            AND "revocation_reason" IS NULL
            AND "revoked_by_membership_id" IS NULL
        )
    );

ALTER TABLE "organization_memberships"
    ADD CONSTRAINT "organization_memberships_source_invitation_id_organization_fkey"
        FOREIGN KEY ("source_invitation_id", "organization_id")
        REFERENCES "invitations"("id", "organization_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invitations"
    ADD CONSTRAINT "invitations_organization_id_issued_by_membership_id_fkey"
        FOREIGN KEY ("organization_id", "issued_by_membership_id")
        REFERENCES "organization_memberships"("organization_id", "id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "invitations_organization_id_revoked_by_membership_id_fkey"
        FOREIGN KEY ("organization_id", "revoked_by_membership_id")
        REFERENCES "organization_memberships"("organization_id", "id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "membership_access_events"
    ADD CONSTRAINT "membership_access_events_organization_id_target_membership_fkey"
        FOREIGN KEY ("organization_id", "target_membership_id")
        REFERENCES "organization_memberships"("organization_id", "id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "membership_access_events_actor_user_id_fkey"
        FOREIGN KEY ("actor_user_id")
        REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "membership_access_events_organization_id_actor_membership__fkey"
        FOREIGN KEY ("organization_id", "actor_membership_id")
        REFERENCES "organization_memberships"("organization_id", "id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "membership_access_event_branch_scopes"
    ADD CONSTRAINT "membership_access_event_branch_scopes_event_id_organizatio_fkey"
        FOREIGN KEY ("event_id", "organization_id")
        REFERENCES "membership_access_events"("id", "organization_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "membership_access_event_branch_scopes_branch_id_organizati_fkey"
        FOREIGN KEY ("branch_id", "organization_id")
        REFERENCES "branches"("id", "organization_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "prevent_membership_access_provenance_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'membership access provenance is immutable';
END;
$$;

CREATE TRIGGER "membership_access_events_immutable"
    BEFORE UPDATE OR DELETE ON "membership_access_events"
    FOR EACH ROW EXECUTE FUNCTION "prevent_membership_access_provenance_mutation"();

CREATE TRIGGER "membership_access_event_branch_scopes_immutable"
    BEFORE UPDATE OR DELETE ON "membership_access_event_branch_scopes"
    FOR EACH ROW EXECUTE FUNCTION "prevent_membership_access_provenance_mutation"();
