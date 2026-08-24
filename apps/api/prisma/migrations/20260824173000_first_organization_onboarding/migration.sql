-- Persist one authoritative first-organization onboarding result per platform
-- user so retries can recover the original tenant and concurrent requests cannot
-- create two logical first organizations.
CREATE TABLE "first_organization_onboardings" (
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "first_organization_onboardings_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "first_organization_onboardings_organization_id_key"
    ON "first_organization_onboardings"("organization_id");

CREATE UNIQUE INDEX "first_organization_onboardings_organization_id_user_id_key"
    ON "first_organization_onboardings"("organization_id", "user_id");

CREATE UNIQUE INDEX "first_organization_onboardings_branch_id_organization_id_key"
    ON "first_organization_onboardings"("branch_id", "organization_id");

ALTER TABLE "first_organization_onboardings"
    ADD CONSTRAINT "first_organization_onboardings_request_hash_check"
        CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "first_organization_onboardings_organization_id_user_id_fkey"
        FOREIGN KEY ("organization_id", "user_id")
        REFERENCES "organization_memberships"("organization_id", "user_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "first_organization_onboardings_branch_id_organization_id_fkey"
        FOREIGN KEY ("branch_id", "organization_id")
        REFERENCES "branches"("id", "organization_id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;
