-- Registration persists only email and password. A display name is collected
-- later during profile/onboarding, so the registration-stage user row permits
-- NULL while the existing nonblank constraint continues to validate values.
ALTER TABLE "users"
    ALTER COLUMN "display_name" DROP NOT NULL;

-- Reintroducing NOT NULL later requires a reviewed backfill and forward
-- migration after every account has completed the required profile step.
