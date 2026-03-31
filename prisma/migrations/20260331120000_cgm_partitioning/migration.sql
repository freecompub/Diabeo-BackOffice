-- Migration: cgm_entries partitioning by month
-- This migration converts cgm_entries to a partitioned table.
-- Must run BEFORE any data is inserted.
-- Prisma cannot manage partitioned tables natively — raw SQL required.

-- Step 1: Drop the Prisma-managed table (empty at this point)
DROP TABLE IF EXISTS "cgm_entries";

-- Step 2: Create partitioned table
CREATE TABLE "cgm_entries" (
    "id"         BIGSERIAL     NOT NULL,
    "patient_id" INTEGER       NOT NULL,
    "value_gl"   DECIMAL(6,4)  NOT NULL CHECK ("value_gl" >= 0.20 AND "value_gl" <= 6.00),
    "timestamp"  TIMESTAMPTZ   NOT NULL,
    "is_manual"  BOOLEAN       NOT NULL DEFAULT false,
    "device_id"  VARCHAR(50),
    "created_at" TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT "cgm_entries_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
) PARTITION BY RANGE ("timestamp");

-- Step 3: Create partitions (2024 Q4 through 2027 Q4)
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

-- Step 4: Create indexes on partitioned table
CREATE INDEX idx_cgm_patient_timestamp ON cgm_entries (patient_id, "timestamp");
CREATE INDEX idx_cgm_timestamp ON cgm_entries ("timestamp");
