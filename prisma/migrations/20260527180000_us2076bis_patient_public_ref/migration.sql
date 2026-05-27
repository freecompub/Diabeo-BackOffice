-- US-2076bis-V2 (Issue #442) — Opaque UUID for patient anonymisation UI.
--
-- Pattern : ensure pgcrypto → add column avec DEFAULT (PG >= 11 fast-path) →
-- SET NOT NULL → CREATE UNIQUE INDEX.
--
-- Rationale anti-énumération : `patient.id` séquentiel autoincrement laisse
-- inférer ordre d'inscription cabinet (timing oracle ANSSI / RGPD Art. 5.1.f).
-- `public_ref` UUID v4 (122 bits entropy) élimine ce vector.
--
-- Le `patient_id` BDD reste l'identifiant interne pour toutes les FK +
-- audit pivot US-2268 — jamais exposé client UI.
--
-- ⚠️  ZERO-DOWNTIME PROD (Fix H3 round 1 review PR #455) ⚠️
-- `CREATE UNIQUE INDEX` (non-CONCURRENT) pose un `ShareLock` qui bloque
-- INSERT/UPDATE/DELETE sur `patients` pendant le scan. Acceptable < 1s
-- sur taille actuelle (< 1000 patients). Si scaling > 100k patients :
--   1. Run cette migration normalement (lock < 5s acceptable maintenance)
--   2. OU séparer en 2 étapes : (a) marquer migration `--applied` sans
--      run + (b) `CREATE UNIQUE INDEX CONCURRENTLY patients_public_ref_key
--      ON patients(public_ref);` hors transaction (impossible dans Prisma
--      migrate qui wrap chaque migration en BEGIN/COMMIT).
-- Cf. `docs/runbook/migrations.md` section "Zero-downtime patterns".

-- Étape 0 — Fix H2 round 1 review PR #455 — assurer `pgcrypto` extension
-- chargée. `gen_random_uuid()` provient de pgcrypto (PG <= 12) OU natif
-- (PG >= 13). Defense-in-depth : `IF NOT EXISTS` idempotent + couvre DR
-- restore from backup sur cluster vierge.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Étape 1 — Add column avec DEFAULT volatile.
-- PG >= 11 fast-path s'applique aux DEFAULTs CONSTANTS uniquement. Avec
-- `gen_random_uuid()` (volatile), PG fait un table rewrite — chaque row
-- existante reçoit un UUID distinct au moment de l'ADD COLUMN. Pas besoin
-- de UPDATE explicite ensuite (Fix M1 round 1 review PR #455 — UPDATE
-- redondant retiré).
-- Cf. https://www.postgresql.org/docs/16/ddl-alter.html#DDL-ALTER-ADDING-A-COLUMN
ALTER TABLE "patients" ADD COLUMN "public_ref" UUID DEFAULT gen_random_uuid();

-- Étape 2 — SET NOT NULL (rapide : toutes rows ont déjà valeur via DEFAULT).
ALTER TABLE "patients" ALTER COLUMN "public_ref" SET NOT NULL;

-- Étape 3 — UNIQUE constraint (empêche collision UUID v4 + permet lookup
-- `publicRef → patientId` interne via index B-tree).
CREATE UNIQUE INDEX "patients_public_ref_key" ON "patients"("public_ref");
