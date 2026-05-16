-- US-2502/2506 round 2 review (post `eaace1a`).
--
-- Findings adressés par cette migration :
--   - M5 : index `appointments(status, date)` pour le hot path cron
--     (sans cet index, le findMany `WHERE status IN (scheduled, confirmed)
--     AND date BETWEEN X AND Y` fait un seq scan à scale 50k patients).
--   - M7 : `sms_logs.cabinet_id ON DELETE CASCADE` → `RESTRICT` pour
--     préserver l'historique audit SMS si un cabinet est supprimé
--     (cohérent avec `invoices.cabinet_id` qui utilise Restrict).
--   - M6 : `appointment_reminders.status DEFAULT 'sent'` → `'skipped'`
--     (defense-in-depth si futur bulk insert omet le statut explicite).

-- ─────────────────────────────────────────────────────────────
-- 1. M5 — Index hot path cron `appointments(status, date)`
-- ─────────────────────────────────────────────────────────────
-- Indexes existants `(memberId, date)`, `(patientId, date)`, `(memberId,
-- status, date)` ne sont pas exploitables par le cron qui filtre sur
-- `status IN ('scheduled', 'confirmed') AND date BETWEEN X AND Y` SANS
-- préfixe memberId/patientId.

CREATE INDEX "appointments_status_date_idx"
    ON "appointments"("status", "date");

-- ─────────────────────────────────────────────────────────────
-- 2. M7 — sms_logs FK CASCADE → RESTRICT
-- ─────────────────────────────────────────────────────────────
-- `HealthcareService` n'est jamais hard-deleted en pratique mais le
-- CASCADE silencieux effacerait l'historique audit SMS forensique. Le
-- pattern Restrict force un admin à réassigner explicitement avant
-- deletion (cohérent avec `invoices.cabinet_id` même contrainte).

ALTER TABLE "sms_logs"
    DROP CONSTRAINT "sms_logs_cabinet_id_fkey";

ALTER TABLE "sms_logs"
    ADD CONSTRAINT "sms_logs_cabinet_id_fkey"
        FOREIGN KEY ("cabinet_id") REFERENCES "healthcare_services"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 3. M6 — appointment_reminders.status DEFAULT skipped
-- ─────────────────────────────────────────────────────────────
-- Default `'sent'` était trompeur : si un futur bulk insert omet le
-- statut, on stocke `sent=true` alors qu'aucun envoi n'a eu lieu.
-- `'skipped'` est défensif (le caller doit explicitement marquer sent).

ALTER TABLE "appointment_reminders"
    ALTER COLUMN "status" SET DEFAULT 'skipped';
