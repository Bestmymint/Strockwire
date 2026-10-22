-- Native-only delivery gating; existing legacy tokens retain their behavior.
ALTER TABLE "password_reset_tokens"
  ADD COLUMN "requires_native_delivery_confirmation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "delivery_confirmed_at" TIMESTAMPTZ(3);

CREATE TABLE "native_password_reset_quotas" (
  "key_hash" VARCHAR(64) PRIMARY KEY,
  "window_started_at" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL CHECK ("attempts" BETWEEN 1 AND 3),
  CONSTRAINT "native_password_reset_quotas_key_hash_check" CHECK ("key_hash" ~ '^[0-9a-f]{64}$')
);
