-- ═══════════════════════════════════════════════════════════════
-- US-2659 (slice S2) — Verrou « UNE seule basale STYLO pending par patient »
-- ═══════════════════════════════════════════════════════════════
-- En split_injection, un patient a DEUX doses (matin + soir). L'index anti-spam existant
-- (`adjustment_proposals_one_pending_per_slot`, tuple avec `basal_dose_kind`, NULLS NOT DISTINCT)
-- autorise DEUX propositions stylo pending simultanées (matin ET soir, cibles distinctes). Or changer
-- les DEUX doses en un run détruit l'attribution matin/soir et risque l'empilement (fenêtres d'action qui
-- se chevauchent). Décision clinique validée (D4 + Q6, medical 2026-07-11) : au plus UNE proposition de
-- basale stylo pending par patient, quelle que soit la cible.
--
-- Le nom contient « one_pending » → la violation P2002 est captée par `isUniqueViolationOn(e, "one_pending")`
-- (adjustment.service.ts) et remontée en `duplicatePendingProposal` (fail-closed, dans EXPECTED_SKIP).
-- Défense en profondeur : le générateur applique aussi un verrou APPLICATIF (une proposition/run + priorité
-- sécurité) ; cet index ferme la course inter-run (cron + on-demand). Ne concerne PAS la pompe
-- (`basal_dose_kind IS NULL`) ni les autres paramètres. Index partiel non modélisé par Prisma (WHERE) →
-- invisible au drift-gate, appliqué par `migrate deploy`. Idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "adjustment_proposals_one_pending_stylo_basal"
  ON "adjustment_proposals" ("patient_id")
  WHERE "parameter_type" = 'basalRate' AND "basal_dose_kind" IS NOT NULL AND "status" = 'pending';
