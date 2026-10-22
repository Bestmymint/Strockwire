-- D2 authority markers: NULL is deliberately non-authorizing.
-- No existing identity is enrolled and no session becomes an application session.
BEGIN;
ALTER TABLE "users" ADD COLUMN "native_registration_completed_at" TIMESTAMPTZ(3);
ALTER TABLE "better_auth_sessions" ADD COLUMN "stockwise_purpose" VARCHAR(16);
ALTER TABLE "better_auth_sessions" ADD CONSTRAINT "better_auth_sessions_purpose_check"
    CHECK ("stockwise_purpose" IS NULL OR "stockwise_purpose" IN ('APPLICATION', 'REGISTRATION'));
COMMIT;
