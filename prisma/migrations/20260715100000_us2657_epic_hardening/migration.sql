-- US-2657 (durcissement review epic) — index anti-cliquet C7 couvrant slot_key + colonnes temporelles
-- timestamptz (cohérence cross-timezone ; `hoursSinceLastAutoApply`).
-- Note : le DROP INDEX n'est PAS « additif » ; les conversions TIMESTAMPTZ ancrent explicitement les
-- valeurs naïves existantes en UTC (`USING … AT TIME ZONE 'UTC'`) — sûr indépendamment du TimeZone de la
-- session qui exécute `migrate deploy` (évite un décalage horaire silencieux si l'exécution n'est pas en UTC).

-- DropIndex
DROP INDEX "auto_apply_events_patient_id_parameter_type_applied_at_idx";

-- AlterTable
ALTER TABLE "auto_apply_events" ALTER COLUMN "applied_at" SET DATA TYPE TIMESTAMPTZ USING "applied_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "governance_approvals" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ USING "created_at" AT TIME ZONE 'UTC';

-- CreateIndex
CREATE INDEX "auto_apply_events_patient_id_parameter_type_slot_key_applie_idx" ON "auto_apply_events"("patient_id", "parameter_type", "slot_key", "applied_at");
