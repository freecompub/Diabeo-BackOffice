-- ═══════════════════════════════════════════════════════════════
-- US-2659 (slice S0b) — Remédiation + CHECK d'exclusivité de cible basale (scopé PENDING)
-- ═══════════════════════════════════════════════════════════════
-- Migration forward de reprise. La version initiale d'S0 posait un CHECK INCONDITIONNEL supposant que
-- toute ligne `basalRate` avait déjà un `pump_basal_slot_id` (XOR vrai) → échec `migrate deploy` (Postgres
-- 23514) sur les propositions legacy adressées par `time_slot_start_hour` SEUL (aucun `pump_basal_slot_id`),
-- héritées d'une version périmée de l'algorithme.
--
-- Cette migration :
--   1. RÉCUPÈRE (backfill NON destructif) les vraies propositions pompe orphelines — mais uniquement quand
--      le rattachement est NON AMBIGU (un seul créneau pompe dans l'heure), pour ne jamais lier au mauvais
--      créneau (sous-découpage horaire type 06:00 + 06:30).
--   2. RETIRE (NON destructif) les orphelins `pending` restants sans cible valide en les passant `expired`
--      — préserve l'enregistrement ET les preuves d'accusé/consentement patient (`AdjustmentProposalAck`,
--      `AdjustmentProposalActualization`, tous deux en `onDelete: Cascade` → un DELETE les effacerait).
--   3. Pose le CHECK d'exclusivité SCOPÉ `status = 'pending'`. L'invariant XOR n'est requis que sur les
--      propositions ACTIONNABLES (revue médecin). Les lignes historiques immuables (accepted/rejected/
--      expired/superseded) avec adressage legacy restent valides sans discriminateur — on ne réécrit ni ne
--      supprime jamais d'historique clinique. Idempotent (`DROP … IF EXISTS` + `ADD`).
--
-- Prisma ne modélise pas les CHECK → invisible au drift-gate, appliqué par `migrate deploy`.

-- (1) BACKFILL NON DESTRUCTIF, NON AMBIGU : rattacher `pump_basal_slot_id` depuis le créneau pompe du
--     patient dont l'heure de début matche `time_slot_start_hour`, UNIQUEMENT s'il n'existe pas de second
--     créneau du même patient dans la même heure (garde anti-mésdosage). Le join ne matche que des configs
--     pompe (seules porteuses de `pump_basal_slots`). `time_slot_start_hour` NULL ⇒ aucun match ⇒ pas de
--     backfill (l'orphelin sera traité à l'étape (2) s'il est pending).
UPDATE "adjustment_proposals" ap
SET "pump_basal_slot_id" = pbs."id"
FROM "pump_basal_slots" pbs
  JOIN "basal_configurations" bc ON pbs."basal_config_id" = bc."id"
  JOIN "insulin_therapy_settings" its ON bc."settings_id" = its."id"
WHERE ap."parameter_type" = 'basalRate'
  AND ap."pump_basal_slot_id" IS NULL
  AND ap."basal_dose_kind" IS NULL
  AND ap."time_slot_start_hour" IS NOT NULL
  AND its."patient_id" = ap."patient_id"
  AND EXTRACT(HOUR FROM pbs."start_time")::int = ap."time_slot_start_hour"
  -- Anti-ambiguïté : pas d'autre créneau pompe du même patient dans la même heure.
  AND NOT EXISTS (
    SELECT 1
    FROM "pump_basal_slots" pbs2
      JOIN "basal_configurations" bc2 ON pbs2."basal_config_id" = bc2."id"
      JOIN "insulin_therapy_settings" its2 ON bc2."settings_id" = its2."id"
    WHERE its2."patient_id" = ap."patient_id"
      AND EXTRACT(HOUR FROM pbs2."start_time")::int = ap."time_slot_start_hour"
      AND pbs2."id" <> pbs."id"
  );

-- (2) OBSERVABILITÉ + RETRAIT NON DESTRUCTIF des orphelins `pending` restants. RAISE NOTICE trace le
--     volume affecté dans les logs de déploiement (traçabilité HDS/CNIL sur données de décision clinique).
--     On passe `expired` (statut terminal) au lieu de DELETE : le CHECK scopé `pending` (étape 3) ne
--     contraint alors plus ces lignes, sans perte d'enregistrement ni cascade sur les accusés/consentements.
DO $$
DECLARE
  n_orphans int;
BEGIN
  SELECT count(*) INTO n_orphans
  FROM "adjustment_proposals"
  WHERE "parameter_type" = 'basalRate'
    AND "status" = 'pending'
    AND "pump_basal_slot_id" IS NULL
    AND "basal_dose_kind" IS NULL;

  RAISE NOTICE 'US-2659 S0b — orphelins basalRate pending sans cible retirés (expired): %', n_orphans;

  UPDATE "adjustment_proposals"
  SET "status" = 'expired'
  WHERE "parameter_type" = 'basalRate'
    AND "status" = 'pending'
    AND "pump_basal_slot_id" IS NULL
    AND "basal_dose_kind" IS NULL;
END $$;

-- (3) CHECK — EXCLUSIVITÉ de la cible basale, SCOPÉE aux propositions actionnables (`status = 'pending'`).
--     `parameter_type = 'basalRate'` est surchargé : cible POMPE (`pump_basal_slot_id`, U/h) OU cible STYLO
--     (`basal_dose_kind`, U totales), jamais les deux, jamais aucune. Hors basalRate, `basal_dose_kind`
--     doit rester NULL. Les lignes NON pending (historique clinique immuable) ne sont pas contraintes :
--     on ne détruit ni ne réécrit jamais un enregistrement de décision passé.
ALTER TABLE "adjustment_proposals" DROP CONSTRAINT IF EXISTS "adjustment_proposals_basal_target_exclusivity_check";
ALTER TABLE "adjustment_proposals" ADD CONSTRAINT "adjustment_proposals_basal_target_exclusivity_check"
  CHECK (
    "status" <> 'pending'
    OR CASE
         WHEN "parameter_type" = 'basalRate'
           THEN ("pump_basal_slot_id" IS NOT NULL) <> ("basal_dose_kind" IS NOT NULL)
         ELSE "basal_dose_kind" IS NULL
       END
  );
