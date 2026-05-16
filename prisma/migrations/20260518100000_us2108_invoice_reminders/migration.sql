-- US-2108 — Relances factures automatiques (Batch 4 Facturation).
--
-- Cron J+7 / J+15 / J+30 via Resend (email service US-2074).
-- Idempotent : UNIQUE(invoiceId, step) empeche envoi double si cron
-- rejoue le meme jour.

-- ─────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────

CREATE TYPE "InvoiceReminderStep" AS ENUM (
    'step_7',    -- J+7 amicale "facture en attente"
    'step_15',   -- J+15 ferme "deuxieme relance"
    'step_30'    -- J+30 finale "derniere relance avant procedure"
);

CREATE TYPE "InvoiceReminderStatus" AS ENUM (
    'sent',      -- Email envoye (Resend OK, message ID present)
    'failed',    -- Resend a echoue (erreur reseau, quota, etc.)
    'skipped'    -- Pas d'email destinataire (invoice cabinet-interne)
);

-- ─────────────────────────────────────────────────────────────
-- 2. Table invoice_reminders
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "invoice_reminders" (
    "id"               SERIAL                  PRIMARY KEY,
    "invoice_id"       INTEGER                 NOT NULL,
    "step"             "InvoiceReminderStep"   NOT NULL,
    "sent_at"          TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status"           "InvoiceReminderStatus" NOT NULL DEFAULT 'sent',
    -- Email destinataire chiffre AES-256-GCM (base64) — forensique sans
    -- exposer mail patient en clair. Optional car certaines step='skipped'
    -- arrivent avant qu'on ait pu deciffrer le destinataire.
    "sent_to_enc"      TEXT,
    -- ID Resend (data.id) — utile pour debug rebonds via Resend dashboard.
    "email_message_id" VARCHAR(100),
    -- Message d'erreur si status='failed' (sans PHI — code Resend ou
    -- timeout). Cap 500 chars contre log spam.
    "error_message"    VARCHAR(500),

    CONSTRAINT "invoice_reminders_invoice_id_fkey"
        FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Idempotence absolue : un seul reminder par (invoice, step). Cron qui
-- rejoue 2x dans la meme heure → P2002 catch + skip silencieux.
CREATE UNIQUE INDEX "invoice_reminders_invoice_id_step_key"
    ON "invoice_reminders"("invoice_id", "step");

-- Index pour query "tous les reminders d'une facture" (export RGPD + UI).
CREATE INDEX "invoice_reminders_invoice_id_sent_at_idx"
    ON "invoice_reminders"("invoice_id", "sent_at" DESC);

-- Index pour metrics ops "combien envoye par jour".
CREATE INDEX "invoice_reminders_sent_at_idx"
    ON "invoice_reminders"("sent_at" DESC);

COMMENT ON TABLE "invoice_reminders" IS
    'US-2108 — Journal des relances factures envoyees (cron J+7/15/30).';
COMMENT ON COLUMN "invoice_reminders"."sent_to_enc" IS
    'Email destinataire chiffre AES-256-GCM base64 (forensique sans PHI clear).';
