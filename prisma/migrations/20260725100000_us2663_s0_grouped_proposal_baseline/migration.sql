-- ═══════════════════════════════════════════════════════════════
-- US-2663 (slice S0) — Généralisation de SlotSetProposal : provenance + snapshot de base
-- ═══════════════════════════════════════════════════════════════
-- Épic « proposition GROUPÉE intégrale » (grouped-only pour TOUS, algorithme compris). S0 = socle de
-- modèle, ADDITIF et RÉVERSIBLE (aucun consommateur ne change) :
--   • `source` (ProposalSource) — provenance dérivée SERVEUR (ADR #27), jamais du body. Les lignes
--     legacy sont TOUTES des soumissions patient (voie US-2657 patient-only) → défaut `patient` (sûr :
--     backfill implicite correct). Les origines `nurse`/`doctor`/`algorithm` arriveront en S3/S4.
--   • `baseline_slots` (JSONB, NULLABLE) — snapshot de la base PAR créneau à la génération, même encodage
--     que `proposed_slots`. Pièce maîtresse du compare-and-swap PAR CRÉNEAU à l'acceptation (S1, garde-fou
--     MDR anti « dérive de base »). Nullable : les propositions `pending` legacy (pré-US-2663) n'ont pas
--     de snapshot → S1 les traitera en full-replace fail-closed (CAS d'ensemble), jamais un merge deviné.
--
-- L'enum `ProposalSource` existe déjà (porté par `AdjustmentProposal`) → AUCUNE création de type ici.
-- `ADD COLUMN IF NOT EXISTS` : idempotence de reprise (cf. incident US-2659 S0 — `migrate deploy` ne
-- wrappe pas le fichier dans une transaction unique ; une reprise doit être rejouable).

ALTER TABLE "slot_set_proposals" ADD COLUMN IF NOT EXISTS "source" "ProposalSource" NOT NULL DEFAULT 'patient';
ALTER TABLE "slot_set_proposals" ADD COLUMN IF NOT EXISTS "baseline_slots" JSONB;
