-- US-2502 + US-2506 — Rappels RDV multi-canal + SMS mock cabinet config.
--
-- US-2502 : email J-2 / SMS J-1 / push J-0 via cron quotidien.
-- US-2506 : option SMS payante cabinet (V1 mock provider, real Twilio/
--           OVH integration deferree V3 — US-2506bis).
--
-- Idempotence absolue : UNIQUE(appointment_id, channel, step) empeche
-- envoi double si cron rejoue.

-- ─────────────────────────────────────────────────────────────
-- 1. US-2506 — HealthcareService.sms_enabled + sms_credit_balance
-- ─────────────────────────────────────────────────────────────
-- `sms_enabled` : feature flag par cabinet (admin toggle).
-- `sms_credit_balance` : credits SMS prepayes (mock V1, real Twilio V3).
--                       Decremente par envoi reussi, alerte si <10.

ALTER TABLE "healthcare_services"
    ADD COLUMN "sms_enabled"         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "sms_credit_balance"  INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN "healthcare_services"."sms_enabled" IS
    'US-2506 V1 mock — Feature flag SMS active par cabinet (admin toggle). Real Twilio V3.';
COMMENT ON COLUMN "healthcare_services"."sms_credit_balance" IS
    'US-2506 V1 mock — Credits SMS prepayes (decrement par envoi).';

-- ─────────────────────────────────────────────────────────────
-- 2. US-2506 — Table sms_logs (audit envois SMS, mock V1)
-- ─────────────────────────────────────────────────────────────

CREATE TYPE "sms_status" AS ENUM (
    'sent',          -- Mock V1 / real Twilio V3 OK
    'failed',        -- Provider erreur
    'skipped',       -- Cabinet sms_enabled=FALSE ou credits=0
    'mock'           -- Explicite mock V1 (pas de vrai envoi)
);

CREATE TABLE "sms_logs" (
    "id"             SERIAL                 PRIMARY KEY,
    "cabinet_id"     INTEGER                NOT NULL,
    "to_enc"         TEXT,                  -- Numero destinataire chiffre AES-256-GCM
    "message_excerpt" VARCHAR(120),         -- 120 premiers chars (anti-PHI : pas plaintext message)
    "status"         "sms_status"           NOT NULL DEFAULT 'mock',
    "provider"       VARCHAR(30)            NOT NULL DEFAULT 'mock', -- 'mock' | 'twilio' | 'ovh'
    "provider_message_id" VARCHAR(100),     -- ID Twilio/OVH si real, mock-UUID si V1
    "credit_cost"    INTEGER                NOT NULL DEFAULT 1,
    "error_message"  VARCHAR(500),
    "sent_at"        TIMESTAMPTZ            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context_kind"   VARCHAR(50)            NOT NULL, -- 'appointment_reminder' | future kinds

    CONSTRAINT "sms_logs_cabinet_id_fkey"
        FOREIGN KEY ("cabinet_id") REFERENCES "healthcare_services"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "sms_logs_cabinet_id_sent_at_idx"
    ON "sms_logs"("cabinet_id", "sent_at" DESC);

CREATE INDEX "sms_logs_sent_at_idx"
    ON "sms_logs"("sent_at" DESC);

COMMENT ON TABLE "sms_logs" IS
    'US-2506 V1 mock — Journal envois SMS (status=mock par defaut V1, real V3).';
COMMENT ON COLUMN "sms_logs"."to_enc" IS
    'Numero destinataire chiffre AES-256-GCM base64 (defensive vs dump BDD).';
COMMENT ON COLUMN "sms_logs"."message_excerpt" IS
    'Apercu 120 chars message (forensique sans plaintext complet contre leak PHI).';

-- ─────────────────────────────────────────────────────────────
-- 3. US-2502 — Table appointment_reminders + enums
-- ─────────────────────────────────────────────────────────────

CREATE TYPE "appointment_reminder_channel" AS ENUM (
    'email',         -- J-2 via Resend (US-2074)
    'sms',           -- J-1 via sms.service (US-2506 mock V1)
    'push'           -- J-0 via FCM (US-2073)
);

CREATE TYPE "appointment_reminder_step" AS ENUM (
    'j_minus_2',     -- 2 jours avant le RDV
    'j_minus_1',     -- 1 jour avant
    'j_0'            -- Jour J
);

CREATE TYPE "appointment_reminder_status" AS ENUM (
    'sent',          -- Envoye avec succes
    'failed',        -- Provider erreur (Resend/SMS/FCM)
    'skipped'        -- Patient sans email/phone/token, ou cabinet sms_enabled=FALSE
);

CREATE TABLE "appointment_reminders" (
    "id"             SERIAL                          PRIMARY KEY,
    "appointment_id" INTEGER                         NOT NULL,
    "channel"        "appointment_reminder_channel"  NOT NULL,
    "step"           "appointment_reminder_step"     NOT NULL,
    "status"         "appointment_reminder_status"   NOT NULL DEFAULT 'sent',
    "sent_at"        TIMESTAMPTZ                     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Destinataire chiffre AES-256-GCM (email ou phone selon channel).
    "sent_to_enc"    TEXT,
    "provider_message_id" VARCHAR(100),
    "error_message"  VARCHAR(500),

    CONSTRAINT "appointment_reminders_appointment_id_fkey"
        FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Idempotence absolue : un seul reminder par (appointment, channel, step).
-- Cron qui rejoue 2x dans la meme journee → P2002 catch + skip silent.
CREATE UNIQUE INDEX "appointment_reminders_appt_channel_step_key"
    ON "appointment_reminders"("appointment_id", "channel", "step");

-- Index pour query "reminders d'un RDV" (export RGPD + UI).
CREATE INDEX "appointment_reminders_appointment_id_sent_at_idx"
    ON "appointment_reminders"("appointment_id", "sent_at" DESC);

-- Index pour metrics ops "combien envoye par jour".
CREATE INDEX "appointment_reminders_sent_at_idx"
    ON "appointment_reminders"("sent_at" DESC);

COMMENT ON TABLE "appointment_reminders" IS
    'US-2502 — Journal rappels RDV envoyes (cron J-2 email / J-1 SMS / J-0 push).';
