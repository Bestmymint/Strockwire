-- Credential versions, not millisecond timestamps, revoke old application authority.
-- NULL remains non-authorizing; no existing session is enrolled.
BEGIN;
ALTER TABLE "better_auth_sessions" ADD COLUMN "stockwise_credential_version" BIGINT;
ALTER TABLE "better_auth_sessions" ADD CONSTRAINT "better_auth_sessions_credential_version_check"
    CHECK ("stockwise_credential_version" IS NULL OR "stockwise_credential_version" > 0);
COMMIT;
