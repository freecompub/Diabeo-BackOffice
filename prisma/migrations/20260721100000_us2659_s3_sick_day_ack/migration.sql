-- ═══════════════════════════════════════════════════════════════
-- US-2659 (slice S3) — Accusé DKA/jour-de-maladie de la baisse basale PATIENT
-- ═══════════════════════════════════════════════════════════════
-- Consentement du patient à un acte à risque : réduire sa basale STYLO en jour de maladie augmente le
-- risque de cétose/acidocétose (l'insulinopénie basale). Colonne timestamp (capture le QUAND du recueil ;
-- NULL = non acquitté), posée une fois à la création de la proposition (immuable — les AdjustmentProposal
-- ne sont jamais mutées après création hors status/reviewedAt/reviewedBy). Requise (=== true côté service)
-- pour une baisse stylo ; persistée aussi si fournie sur une pompe (non bloquante), jamais silencieusement
-- jetée (donnée de sécurité). Additif, nullable, non destructif.
ALTER TABLE "adjustment_proposals" ADD COLUMN "sick_day_acknowledged_at" TIMESTAMPTZ;
