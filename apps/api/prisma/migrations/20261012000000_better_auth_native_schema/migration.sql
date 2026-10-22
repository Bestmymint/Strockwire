-- Additive D1 only: no live auth cutover or credential migration.
-- The PHC default is public dummy material with a discarded random preimage.
BEGIN;

ALTER TABLE "users"
    ADD COLUMN "better_auth_email_verified" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "better_auth_image" TEXT,
    ALTER COLUMN "password_hash" SET DEFAULT '$argon2id$v=19$m=65536,p=4,t=3$MELWslgkJzw87Me69Wz1tw$l9XoBv1UBhpmS40M2xzT5cHzqoSubftPd1Md5u/ZmvQ';

-- Snapshot only. Legacy writers remain authoritative until the gated cutover.
UPDATE "users"
SET "better_auth_email_verified" = true
WHERE "email_verified_at" IS NOT NULL;

CREATE TABLE "better_auth_sessions" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "better_auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "better_auth_accounts" (
    "id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "password" TEXT,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "better_auth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "better_auth_verifications" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "better_auth_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "better_auth_sessions_token_key" ON "better_auth_sessions"("token");
CREATE INDEX "better_auth_sessions_user_id_idx" ON "better_auth_sessions"("user_id");
CREATE INDEX "better_auth_accounts_user_id_idx" ON "better_auth_accounts"("user_id");
CREATE UNIQUE INDEX "better_auth_accounts_provider_id_account_id_key" ON "better_auth_accounts"("provider_id", "account_id");
CREATE INDEX "better_auth_verifications_identifier_idx" ON "better_auth_verifications"("identifier");

ALTER TABLE "better_auth_sessions" ADD CONSTRAINT "better_auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "better_auth_accounts" ADD CONSTRAINT "better_auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
