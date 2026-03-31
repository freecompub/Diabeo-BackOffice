-- ═══════════════════════════════════════════════════════════════
-- CGM Entries Partitioning — Reference SQL
-- ═══════════════════════════════════════════════════════════════
-- Apply AFTER the initial Prisma migration creates the tables.
-- This replaces Prisma's cgm_entries with a partitioned version.
--
-- Volume: ~105K rows/patient/year (288 readings/day @ 5 min interval)
-- Strategy: Quarterly partitions with a DEFAULT partition for overflow.
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Drop the Prisma-managed table (must be empty)
DROP TABLE IF EXISTS "cgm_entries";

-- Step 2: Create partitioned table with composite PK
-- PostgreSQL requires the partition key in any unique/primary key.
CREATE TABLE "cgm_entries" (
    "id"         BIGSERIAL     NOT NULL,
    "patient_id" INTEGER       NOT NULL,
    "value_gl"   DECIMAL(6,4)  NOT NULL CHECK ("value_gl" >= 0.20 AND "value_gl" <= 6.00),
    "timestamp"  TIMESTAMPTZ   NOT NULL,
    "is_manual"  BOOLEAN       NOT NULL DEFAULT false,
    "device_id"  VARCHAR(50),
    "created_at" TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    PRIMARY KEY ("id", "timestamp"),
    CONSTRAINT "cgm_entries_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
) PARTITION BY RANGE ("timestamp");

-- Step 3: Quarterly partitions (2024 Q4 through 2028 Q4)
CREATE TABLE cgm_entries_2024_q4 PARTITION OF cgm_entries
    FOR VALUES FROM ('2024-10-01') TO ('2025-01-01');

CREATE TABLE cgm_entries_2025_q1 PARTITION OF cgm_entries
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE cgm_entries_2025_q2 PARTITION OF cgm_entries
    FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE cgm_entries_2025_q3 PARTITION OF cgm_entries
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE cgm_entries_2025_q4 PARTITION OF cgm_entries
    FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

CREATE TABLE cgm_entries_2026_q1 PARTITION OF cgm_entries
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE cgm_entries_2026_q2 PARTITION OF cgm_entries
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE cgm_entries_2026_q3 PARTITION OF cgm_entries
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE cgm_entries_2026_q4 PARTITION OF cgm_entries
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

CREATE TABLE cgm_entries_2027_q1 PARTITION OF cgm_entries
    FOR VALUES FROM ('2027-01-01') TO ('2027-04-01');
CREATE TABLE cgm_entries_2027_q2 PARTITION OF cgm_entries
    FOR VALUES FROM ('2027-04-01') TO ('2027-07-01');
CREATE TABLE cgm_entries_2027_q3 PARTITION OF cgm_entries
    FOR VALUES FROM ('2027-07-01') TO ('2027-10-01');
CREATE TABLE cgm_entries_2027_q4 PARTITION OF cgm_entries
    FOR VALUES FROM ('2027-10-01') TO ('2028-01-01');

CREATE TABLE cgm_entries_2028_q1 PARTITION OF cgm_entries
    FOR VALUES FROM ('2028-01-01') TO ('2028-04-01');
CREATE TABLE cgm_entries_2028_q2 PARTITION OF cgm_entries
    FOR VALUES FROM ('2028-04-01') TO ('2028-07-01');
CREATE TABLE cgm_entries_2028_q3 PARTITION OF cgm_entries
    FOR VALUES FROM ('2028-07-01') TO ('2028-10-01');
CREATE TABLE cgm_entries_2028_q4 PARTITION OF cgm_entries
    FOR VALUES FROM ('2028-10-01') TO ('2029-01-01');

-- Default partition — catches any data outside defined ranges
CREATE TABLE cgm_entries_default PARTITION OF cgm_entries DEFAULT;

-- Step 4: Indexes
CREATE INDEX idx_cgm_patient_timestamp ON cgm_entries (patient_id, "timestamp");
CREATE INDEX idx_cgm_timestamp ON cgm_entries ("timestamp");
