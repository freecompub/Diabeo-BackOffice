-- ═══════════════════════════════════════════════════════════════
-- US-2663 (slice S4, décision produit D3) — Accusé DKA sur la soumission GROUPÉE patient
-- ═══════════════════════════════════════════════════════════════
-- La voie manuelle GROUPÉE (patient/infirmière/médecin) porte désormais la basale : une soumission PATIENT
-- d'un jeu contenant ≥ 1 BAISSE de basale STYLO exige un accusé « jour-de-maladie / DKA » (US-2659 — réduire
-- une basale lente en jour de maladie augmente le risque d'acidocétose). **Décision produit D3** : un jeu
-- pouvant mélanger hausses ET baisses, UN SEUL accusé couvre TOUTES les baisses stylo du jeu → l'accusé est
-- porté au niveau de la PROPOSITION (pas par créneau).
--
-- `sick_day_acknowledged_at` (Timestamptz, NULLABLE) — timestamp de consentement, parité EXACTE avec
-- `AdjustmentProposal.sick_day_acknowledged_at` (US-2659) : immuable applicativement (jamais réécrit après
-- création), forensic-ready HDS. NULL pour : toute soumission sans baisse stylo, les pros (nurse/doctor —
-- non gatés, cliniciens qualifiés), et le moteur (`source = algorithm`).
--
-- ADDITIF / NON DESTRUCTIF (colonne nullable, aucune ligne existante rejetée ; les propositions legacy
-- restent NULL = « aucune baisse stylo accusée », sémantiquement correct). `ADD COLUMN IF NOT EXISTS` :
-- idempotence de reprise (`migrate deploy` ne wrappe pas le fichier dans une transaction unique).

ALTER TABLE "slot_set_proposals" ADD COLUMN IF NOT EXISTS "sick_day_acknowledged_at" TIMESTAMPTZ;
