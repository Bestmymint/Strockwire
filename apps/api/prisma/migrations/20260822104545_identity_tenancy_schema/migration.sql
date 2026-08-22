-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "organization_role" AS ENUM ('OWNER', 'ADMIN', 'BRANCH_MANAGER', 'INVENTORY_STAFF', 'CASHIER');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "branch_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "branch_assignment_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "display_name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(32),
    "email_verified_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "organization_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("organization_id","user_id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(32),
    "address" VARCHAR(500),
    "status" "branch_status" NOT NULL DEFAULT 'ACTIVE',
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_assignments" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "branch_assignment_status" NOT NULL DEFAULT 'ACTIVE',
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_assignments_pkey" PRIMARY KEY ("organization_id","user_id","branch_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revocation_reason" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invited_email" VARCHAR(320) NOT NULL,
    "intended_role" "organization_role" NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_at" TIMESTAMPTZ(3),
    "accepted_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_branch_scopes" (
    "organization_id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "invitation_branch_scopes_pkey" PRIMARY KEY ("organization_id","invitation_id","branch_id")
);

-- Database checks Prisma cannot currently express. Email values are stored in
-- their canonical trimmed, lowercase form so the ordinary unique index is also
-- the global normalized-email identity constraint.
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_normalized_check" CHECK ("email" = lower(btrim("email")) AND "email" <> ''),
    ADD CONSTRAINT "users_password_hash_not_blank_check" CHECK ("password_hash" <> ''),
    ADD CONSTRAINT "users_display_name_not_blank_check" CHECK (btrim("display_name") <> ''),
    ADD CONSTRAINT "users_status_deactivation_check" CHECK (
        ("status" = 'ACTIVE' AND "disabled_at" IS NULL)
        OR ("status" = 'DISABLED' AND "disabled_at" IS NOT NULL)
    );

ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_name_not_blank_check" CHECK (btrim("name") <> ''),
    ADD CONSTRAINT "organizations_status_deactivation_check" CHECK (
        ("status" = 'ACTIVE' AND "deactivated_at" IS NULL)
        OR ("status" = 'INACTIVE' AND "deactivated_at" IS NOT NULL)
    );

ALTER TABLE "organization_memberships"
    ADD CONSTRAINT "organization_memberships_status_deactivation_check" CHECK (
        ("status" = 'ACTIVE' AND "deactivated_at" IS NULL)
        OR ("status" = 'INACTIVE' AND "deactivated_at" IS NOT NULL)
    );

ALTER TABLE "branches"
    ADD CONSTRAINT "branches_code_not_blank_check" CHECK (btrim("code") <> ''),
    ADD CONSTRAINT "branches_name_not_blank_check" CHECK (btrim("name") <> ''),
    ADD CONSTRAINT "branches_status_deactivation_check" CHECK (
        ("status" = 'ACTIVE' AND "deactivated_at" IS NULL)
        OR ("status" = 'INACTIVE' AND "deactivated_at" IS NOT NULL)
    );

ALTER TABLE "branch_assignments"
    ADD CONSTRAINT "branch_assignments_status_deactivation_check" CHECK (
        ("status" = 'ACTIVE' AND "deactivated_at" IS NULL)
        OR ("status" = 'INACTIVE' AND "deactivated_at" IS NOT NULL)
    );

ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_token_hash_not_blank_check" CHECK ("token_hash" <> ''),
    ADD CONSTRAINT "sessions_expiry_order_check" CHECK (
        "issued_at" <= "last_used_at"
        AND "issued_at" < "idle_expires_at"
        AND "last_used_at" < "idle_expires_at"
        AND "idle_expires_at" <= "absolute_expires_at"
        AND "last_used_at" <= "absolute_expires_at"
    ),
    ADD CONSTRAINT "sessions_revocation_check" CHECK (
        ("revocation_reason" IS NULL OR "revoked_at" IS NOT NULL)
        AND ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")
    );

ALTER TABLE "email_verification_tokens"
    ADD CONSTRAINT "email_verification_tokens_hash_not_blank_check" CHECK ("token_hash" <> ''),
    ADD CONSTRAINT "email_verification_tokens_expiry_check" CHECK ("expires_at" > "issued_at"),
    ADD CONSTRAINT "email_verification_tokens_state_check" CHECK (
        num_nonnulls("consumed_at", "revoked_at", "replaced_at") <= 1
        AND ("consumed_at" IS NULL OR "consumed_at" >= "issued_at")
        AND ("consumed_at" IS NULL OR "consumed_at" <= "expires_at")
        AND ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")
        AND ("replaced_at" IS NULL OR "replaced_at" >= "issued_at")
    );

ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_hash_not_blank_check" CHECK ("token_hash" <> ''),
    ADD CONSTRAINT "password_reset_tokens_expiry_check" CHECK ("expires_at" > "issued_at"),
    ADD CONSTRAINT "password_reset_tokens_state_check" CHECK (
        num_nonnulls("consumed_at", "revoked_at", "replaced_at") <= 1
        AND ("consumed_at" IS NULL OR "consumed_at" >= "issued_at")
        AND ("consumed_at" IS NULL OR "consumed_at" <= "expires_at")
        AND ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")
        AND ("replaced_at" IS NULL OR "replaced_at" >= "issued_at")
    );

ALTER TABLE "invitations"
    ADD CONSTRAINT "invitations_email_normalized_check" CHECK ("invited_email" = lower(btrim("invited_email")) AND "invited_email" <> ''),
    ADD CONSTRAINT "invitations_hash_not_blank_check" CHECK ("token_hash" <> ''),
    ADD CONSTRAINT "invitations_expiry_check" CHECK ("expires_at" > "issued_at"),
    ADD CONSTRAINT "invitations_state_check" CHECK (
        num_nonnulls("consumed_at", "revoked_at", "replaced_at") <= 1
        AND ("consumed_at" IS NULL OR "consumed_at" >= "issued_at")
        AND ("consumed_at" IS NULL OR "consumed_at" <= "expires_at")
        AND ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")
        AND ("replaced_at" IS NULL OR "replaced_at" >= "issued_at")
        AND (("consumed_at" IS NULL) = ("accepted_by_user_id" IS NULL))
    );

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_email_key" ON "users"("id", "email");

-- CreateIndex
CREATE INDEX "organization_memberships_user_status_idx" ON "organization_memberships"("user_id", "status", "organization_id");

-- CreateIndex
CREATE INDEX "branches_organization_id_status_idx" ON "branches"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_code_key" ON "branches"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_id_organization_id_key" ON "branches"("id", "organization_id");

-- CreateIndex
CREATE INDEX "branch_assignments_user_status_idx" ON "branch_assignments"("user_id", "status", "organization_id");

-- CreateIndex
CREATE INDEX "branch_assignments_branch_status_idx" ON "branch_assignments"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branch_assignments_branch_id_user_id_key" ON "branch_assignments"("branch_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_revoked_absolute_expiry_idx" ON "sessions"("user_id", "revoked_at", "absolute_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_expiry_idx" ON "email_verification_tokens"("user_id", "expires_at");

-- Resend must invalidate or replace the previous open token first. Expired
-- records remain open until that transaction marks them replaced/revoked.
CREATE UNIQUE INDEX "email_verification_tokens_one_open_per_user_key"
ON "email_verification_tokens"("user_id")
WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL AND "replaced_at" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_expiry_idx" ON "password_reset_tokens"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_invited_email_idx" ON "invitations"("organization_id", "invited_email");

-- CreateIndex
CREATE INDEX "invitations_accepted_by_user_id_idx" ON "invitations"("accepted_by_user_id");

-- Changed invitation role/scope is represented by replacing the existing open
-- invitation, leaving the old record and its branch-scope rows intact.
CREATE UNIQUE INDEX "invitations_one_open_per_organization_email_key"
ON "invitations"("organization_id", "invited_email")
WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL AND "replaced_at" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "invitations_id_organization_id_key" ON "invitations"("id", "organization_id");

-- CreateIndex
CREATE INDEX "invitation_branch_scopes_invitation_organization_idx" ON "invitation_branch_scopes"("invitation_id", "organization_id");

-- CreateIndex
CREATE INDEX "invitation_branch_scopes_branch_organization_idx" ON "invitation_branch_scopes"("branch_id", "organization_id");

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "branch_assignments" ADD CONSTRAINT "branch_assignments_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "organization_memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "branch_assignments" ADD CONSTRAINT "branch_assignments_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_invited_email_fkey" FOREIGN KEY ("accepted_by_user_id", "invited_email") REFERENCES "users"("id", "email") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invitation_branch_scopes" ADD CONSTRAINT "invitation_branch_scopes_invitation_id_organization_id_fkey" FOREIGN KEY ("invitation_id", "organization_id") REFERENCES "invitations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "invitation_branch_scopes" ADD CONSTRAINT "invitation_branch_scopes_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
