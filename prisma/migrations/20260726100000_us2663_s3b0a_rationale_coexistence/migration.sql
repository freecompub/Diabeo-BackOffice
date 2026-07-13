-- ═══════════════════════════════════════════════════════════════
-- US-2663 (slice S3b-0a) — Rationale moteur + coexistence humain ⇄ algorithme (SlotSetProposal)
-- ═══════════════════════════════════════════════════════════════
-- Prépare la bascule du moteur en émission GROUPÉE (S3b-1). Deux besoins tranchés en revue de design :
--
--   1. RATIONALE (R3, medical HIGH) — le modèle groupé ne portait que `{startHour,endHour,value}`. Pour une
--      proposition MOTEUR (`source='algorithm'`), le médecin doit voir le POURQUOI (reason), la CONFIANCE et
--      le VOLUME d'observations par créneau changé (decision-support + traçabilité HDS de la recommandation
--      de dose). Colonne `rationale` JSONB **nullable** : `[{ startHour, reason, confidence, supportingEvents,
--      changePercent?, averageObservedValue?, analysisPeriod? }]` (par créneau CHANGÉ). Nullable = propositions
--      humaines (patient/infirmier/médecin) sans rationale algorithmique ; requise APPLICATIVEMENT si algorithme.
--      Pas de PHI (valeurs de config + métriques d'analyse).
--
--   2. COEXISTENCE humain ⇄ algorithme (décision produit D2) — le moteur nocturne ne doit PAS écraser une
--      demande HUMAINE pending (le médecin voit les DEUX ; l'algorithme est la « 2e proposition »). On relâche
--      l'invariant « 1 pending / (patient × paramètre) » en « 1 pending HUMAIN **+** 1 pending ALGORITHME » via
--      un discriminant booléen `source = 'algorithm'` dans la clé unique partielle. Le nouveau nom conserve
--      « one_pending » → la détection P2002 (`isUniqueViolationOn(e, "one_pending")`) reste valable.
--
-- Additif/réversible. `IF EXISTS`/`IF NOT EXISTS` = idempotence de reprise (leçon US-2659 S0).

ALTER TABLE "slot_set_proposals" ADD COLUMN IF NOT EXISTS "rationale" JSONB;

DROP INDEX IF EXISTS "slot_set_proposals_one_pending_per_param";
CREATE UNIQUE INDEX IF NOT EXISTS "slot_set_proposals_one_pending_per_param_origin"
  ON "slot_set_proposals" ("patient_id", "parameter_type", (("source" = 'algorithm')))
  WHERE "status" = 'pending';
