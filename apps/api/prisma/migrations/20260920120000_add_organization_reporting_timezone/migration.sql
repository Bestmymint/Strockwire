-- Analytics reporting uses one required Organization IANA timezone. PostgreSQL
-- stores the identifier; runtime validation remains authoritative because PostgreSQL
-- does not provide a stable IANA identifier constraint suitable for this column.
ALTER TABLE "organizations"
    ADD COLUMN "reporting_timezone" VARCHAR(255) NOT NULL DEFAULT 'Asia/Bangkok';
