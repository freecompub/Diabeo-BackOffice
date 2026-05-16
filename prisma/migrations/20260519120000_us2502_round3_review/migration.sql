-- US-2502 round 3 review — migrations suiveuses.
--
-- MED-2 : index GIN partial sur metadata->'runId' pour forensique cron
--         (les events `cron.run`, `cron.skipped_locked`, `cron.timeout`
--         et per-reminder ont `metadata.runId`). Sans cet index, une
--         query forensique `WHERE metadata @> '{"runId": "x"}'` ferait
--         un seq scan sur audit_logs (>10M rows attendus).
--
-- MED-6 : note CONCURRENTLY pour le futur — l'index `appointments_status_date_idx`
--         créé en round 2 (M5) prend un AccessExclusiveLock bref pendant la
--         build. Acceptable V1 (table < 100k rows), à recréer CONCURRENTLY
--         si scaling >1M rows. Voir `docs/runbook/cron-reminders.md` §rebuild.
--
-- LOW-5 : CHECK constraint cohérence (status='sent') ⇒ providerMessageId
--         IS NOT NULL pour `appointment_reminders`. Le M6 round 2 a posé
--         `status DEFAULT 'skipped'`, mais `sentAt @default(now())` reste
--         absolu — un INSERT sans status produirait `(skipped, now())`.
--         Acceptable car le service set toujours `status` explicitement,
--         mais on durcit le contrat DB-level :
--           - status='sent'   ⇒ providerMessageId IS NOT NULL OR channel='push'
--           - status='failed' ⇒ errorMessage IS NOT NULL
--           - status='skipped' ⇒ errorMessage IS NOT NULL
--         (push 'sent' peut ne pas avoir providerMessageId si FCM batch
--          ne retourne pas de registrationId clair → seul errorMessage IS NULL
--          autorisé en sent, providerMessageId optional pour push).

-- ─────────────────────────────────────────────────────────────
-- MED-2 — GIN partial index pour forensique by runId
-- ─────────────────────────────────────────────────────────────
-- Note : `CREATE INDEX CONCURRENTLY` ne peut pas tourner dans une
-- transaction. Prisma 7 emballe chaque migration .sql dans une TX implicite.
-- On utilise donc le mode non-concurrent ici (acceptable car `audit_logs`
-- est faiblement utilisée en écriture pendant maintenance).
-- Pour production avec audit_logs > 100M rows, voir runbook §rebuild_runid_gin.
CREATE INDEX IF NOT EXISTS "audit_logs_run_id_gin_idx"
    ON "audit_logs" USING gin ((metadata -> 'runId'))
    WHERE metadata ? 'runId';

-- ─────────────────────────────────────────────────────────────
-- LOW-5 — CHECK cohérence appointment_reminders status/fields
-- ─────────────────────────────────────────────────────────────
-- Defense-in-depth : empêche un bug applicatif d'insérer un row
-- "status=failed, errorMessage=NULL" qui rendrait la forensique aveugle.
ALTER TABLE "appointment_reminders"
    ADD CONSTRAINT "appointment_reminders_status_fields_coherence_check"
    CHECK (
        (status = 'sent' AND error_message IS NULL)
        OR (status = 'failed' AND error_message IS NOT NULL)
        OR (status = 'skipped' AND error_message IS NOT NULL)
    ) NOT VALID;

-- VALIDATE séparé pour éviter scan-blocking sur table existante.
ALTER TABLE "appointment_reminders"
    VALIDATE CONSTRAINT "appointment_reminders_status_fields_coherence_check";
