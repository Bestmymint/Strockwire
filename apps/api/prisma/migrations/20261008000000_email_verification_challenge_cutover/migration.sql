-- ADR-034 cutover: evolve the link-only email verification token into the
-- unified OTP/link verification challenge. Every preexisting row is a legacy
-- row; the cutover terminalizes every nonterminal legacy row (including
-- expired-open rows) while preserving all terminal history. The table is
-- evolved and renamed, never dropped.
BEGIN;

-- CreateEnum
CREATE TYPE "verification_consumption_method" AS ENUM ('OTP', 'LINK');

-- CreateEnum
CREATE TYPE "verification_revocation_reason" AS ENUM ('LEGACY_CUTOVER', 'DELIVERY_SUPPRESSED', 'DELIVERY_FAILED', 'RESPONSE_ABORTED', 'PASSWORD_RESET');

-- RenameTable: the predecessor table is evolved, never dropped.
ALTER TABLE "email_verification_tokens" RENAME TO "email_verification_challenges";

-- RenameConstraint: keep the primary key name aligned with the evolved table.
ALTER TABLE "email_verification_challenges" RENAME CONSTRAINT "email_verification_tokens_pkey" TO "email_verification_challenges_pkey";

-- RenameColumn: the link-only token hash becomes the unified link token hash,
-- retaining VARCHAR(128) so legacy arbitrary nonblank hashes are preserved.
ALTER TABLE "email_verification_challenges" RENAME COLUMN "token_hash" TO "link_token_hash";

-- RenameConstraint: keep the restrictive user FK name aligned with the table.
ALTER TABLE "email_verification_challenges" RENAME CONSTRAINT "email_verification_tokens_user_id_fkey" TO "email_verification_challenges_user_id_fkey";

-- RenameIndex
ALTER INDEX "email_verification_tokens_token_hash_key" RENAME TO "email_verification_challenges_link_token_hash_key";

-- RenameIndex
ALTER INDEX "email_verification_tokens_user_expiry_idx" RENAME TO "email_verification_challenges_user_expiry_idx";

-- RenameIndex: the one-nonterminal-challenge-per-user partial unique index is
-- carried over; after cutover every legacy row is terminal, so it bounds new
-- nonterminal challenges.
ALTER INDEX "email_verification_tokens_one_open_per_user_key" RENAME TO "email_verification_challenges_one_open_per_user_key";

-- The predecessor's checks are superseded by the cutover checks below. The
-- not-blank and expiry checks are re-added with the evolved table name, and
-- the state check is replaced by the terminal-state, consumption, and
-- discriminator checks.
ALTER TABLE "email_verification_challenges"
    DROP CONSTRAINT "email_verification_tokens_hash_not_blank_check",
    DROP CONSTRAINT "email_verification_tokens_expiry_check",
    DROP CONSTRAINT "email_verification_tokens_state_check";

-- AddColumn: immutable credential-version snapshot and OTP material for new
-- challenges. All nullable so legacy rows stay free of fabricated values.
ALTER TABLE "email_verification_challenges"
    ADD COLUMN "credential_version" BIGINT,
    ADD COLUMN "otp_mac" VARCHAR(64),
    ADD COLUMN "otp_key_id" INTEGER,
    ADD COLUMN "failed_otp_attempts" INTEGER,
    ADD COLUMN "consumed_via" "verification_consumption_method",
    ADD COLUMN "revocation_reason" "verification_revocation_reason",
    ADD COLUMN "is_legacy" BOOLEAN NOT NULL DEFAULT FALSE;

-- AddColumn: authoritative positive monotonic credential version, initially 1.
ALTER TABLE "users"
    ADD COLUMN "credential_version" BIGINT NOT NULL DEFAULT 1;

-- Backfill the legacy discriminator before installing constraints or the
-- protection trigger. Every preexisting row is a legacy row.
UPDATE "email_verification_challenges"
SET "is_legacy" = TRUE;

-- Cutover terminalizes every nonterminal legacy row, including expired-open
-- and future-issued rows, as revoked with the legacy cutover reason. The
-- revocation never precedes issuance, so preserved terminal ordering holds.
-- Already-terminal rows keep their preserved timestamps and (absent)
-- historical reason.
UPDATE "email_verification_challenges"
SET "revoked_at" = GREATEST(now(), "issued_at"),
    "revocation_reason" = 'LEGACY_CUTOVER'
WHERE "is_legacy" = TRUE
  AND "consumed_at" IS NULL
  AND "revoked_at" IS NULL
  AND "replaced_at" IS NULL;

-- The predecessor was link-only, so historically consumed legacy rows are
-- recorded as consumed via LINK (never a fabricated OTP).
UPDATE "email_verification_challenges"
SET "consumed_via" = 'LINK'
WHERE "is_legacy" = TRUE
  AND "consumed_at" IS NOT NULL;

-- Database checks Prisma cannot express.
ALTER TABLE "email_verification_challenges"
    ADD CONSTRAINT "email_verification_challenges_link_token_hash_not_blank_check" CHECK ("link_token_hash" <> ''),
    ADD CONSTRAINT "email_verification_challenges_expiry_check" CHECK (
        ("is_legacy" = TRUE AND "expires_at" > "issued_at")
        OR ("is_legacy" = FALSE AND "expires_at" = "issued_at" + interval '10 minutes')
    ),
    ADD CONSTRAINT "email_verification_challenges_terminal_state_check" CHECK (
        ("consumed_at" IS NULL OR "consumed_at" >= "issued_at")
        AND ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")
        AND ("replaced_at" IS NULL OR "replaced_at" >= "issued_at")
        AND ("consumed_at" IS NULL OR "revoked_at" IS NULL)
        AND ("consumed_at" IS NULL OR "replaced_at" IS NULL)
        AND ("revoked_at" IS NULL OR "replaced_at" IS NULL)
    ),
    ADD CONSTRAINT "email_verification_challenges_consumption_check" CHECK (
        "consumed_at" IS NULL
        OR ("is_legacy" = TRUE AND "consumed_at" <= "expires_at")
        OR ("is_legacy" = FALSE AND "consumed_at" < "expires_at")
    ),
    ADD CONSTRAINT "email_verification_challenges_consumed_via_check" CHECK (
        ("consumed_via" IS NULL) = ("consumed_at" IS NULL)
        AND ("is_legacy" = FALSE OR "consumed_via" IS DISTINCT FROM 'OTP')
    ),
    ADD CONSTRAINT "email_verification_challenges_legacy_terminal_check" CHECK (
        "is_legacy" = FALSE
        OR "consumed_at" IS NOT NULL
        OR "revoked_at" IS NOT NULL
        OR "replaced_at" IS NOT NULL
    ),
    ADD CONSTRAINT "email_verification_challenges_legacy_no_fabricated_fields_check" CHECK (
        "is_legacy" = FALSE
        OR ("credential_version" IS NULL
            AND "otp_mac" IS NULL
            AND "otp_key_id" IS NULL
            AND "failed_otp_attempts" IS NULL)
    ),
    ADD CONSTRAINT "email_verification_challenges_new_required_fields_check" CHECK (
        "is_legacy" = TRUE
        OR ("credential_version" IS NOT NULL
            AND "credential_version" > 0
            AND "otp_mac" IS NOT NULL
            AND "otp_key_id" IS NOT NULL
            AND "failed_otp_attempts" IS NOT NULL)
    ),
    ADD CONSTRAINT "email_verification_challenges_new_digest_check" CHECK (
        "is_legacy" = TRUE
        OR ("link_token_hash" ~ '^[0-9a-f]{64}$'
            AND "otp_mac" ~ '^[0-9a-f]{64}$')
    ),
    ADD CONSTRAINT "email_verification_challenges_attempts_bounds_check" CHECK (
        "failed_otp_attempts" IS NULL
        OR ("failed_otp_attempts" >= 0 AND "failed_otp_attempts" <= 5)
    ),
    ADD CONSTRAINT "email_verification_challenges_otp_key_id_positive_check" CHECK (
        "otp_key_id" IS NULL OR "otp_key_id" > 0
    ),
    ADD CONSTRAINT "email_verification_challenges_revocation_reason_check" CHECK (
        ("revocation_reason" IS NULL OR "revoked_at" IS NOT NULL)
        AND ("is_legacy" = TRUE OR "revocation_reason" IS DISTINCT FROM 'LEGACY_CUTOVER')
        AND ("is_legacy" = TRUE OR ("revoked_at" IS NOT NULL) = ("revocation_reason" IS NOT NULL))
        AND ("revocation_reason" IS NULL OR "revocation_reason" = 'LEGACY_CUTOVER' OR "is_legacy" = FALSE)
    );

ALTER TABLE "users"
    ADD CONSTRAINT "users_credential_version_positive_check" CHECK ("credential_version" > 0);

-- The legacy discriminator is fixed at cutover: new rows are never inserted as
-- legacy, and no row may change its discriminator after the backfill. The
-- backfill precedes this trigger, so it is not blocked.
CREATE FUNCTION "prevent_verification_challenge_legacy_discriminator_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW."is_legacy" THEN
        RAISE EXCEPTION 'verification challenges cannot be inserted as legacy';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."is_legacy" IS DISTINCT FROM OLD."is_legacy" THEN
        RAISE EXCEPTION 'verification challenge legacy discriminator is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "email_verification_challenges_legacy_discriminator_immutable"
    BEFORE INSERT OR UPDATE ON "email_verification_challenges"
    FOR EACH ROW EXECUTE FUNCTION "prevent_verification_challenge_legacy_discriminator_mutation"();

COMMIT;
