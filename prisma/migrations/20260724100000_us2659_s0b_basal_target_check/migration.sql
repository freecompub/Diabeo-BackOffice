-- ═══════════════════════════════════════════════════════════════
-- US-2659 (slice S0b) — Remédiation + CHECK d'exclusivité de cible basale (scopé PENDING)
-- ═══════════════════════════════════════════════════════════════
-- Migration forward de reprise. La version initiale d'S0 posait un CHECK INCONDITIONNEL supposant que
-- toute ligne `basalRate` avait déjà un `pump_basal_slot_id` (XOR vrai) → échec `migrate deploy` (Postgres
-- 23514) sur les propositions legacy adressées par `time_slot_start_hour` SEUL (aucun `pump_basal_slot_id`),
-- héritées d'une version périmée de l'algorithme.
--
-- Cette migration (idempotente — rejouable sans effet de bord) :
--   1. RÉCUPÈRE (backfill NON destructif, scopé `pending`) les vraies propositions pompe orphelines — mais
--      uniquement quand le rattachement est NON AMBIGU (un seul créneau POMPE `config_type='pump'` dans
--      l'heure), pour ne jamais lier au mauvais créneau (sous-découpage horaire type 06:00 + 06:30) ni à un
--      créneau pompe PÉRIMÉ (patient basculé pompe→stylo, `pump_basal_slots` non purgés par `upsertBasalConfig`).
--   2. RETIRE (NON destructif) les orphelins `pending` restants sans cible valide en les passant `expired`
--      — préserve l'enregistrement ET les preuves d'accusé/consentement patient (`AdjustmentProposalAck`,
--      `AdjustmentProposalActualization`, tous deux en `onDelete: Cascade` → un DELETE les effacerait).
--   3. TRACE la modification de masse dans `audit_logs` (durable, immuable, requêtable — HDS/CNIL), en plus
--      du `RAISE NOTICE` (logs de déploiement). Événement système, aucun PHI (compteurs seuls).
--   4. Pose le CHECK d'exclusivité SCOPÉ `status = 'pending'`. L'invariant XOR n'est requis que sur les
--      propositions ACTIONNABLES (revue médecin). Les lignes historiques immuables (accepted/rejected/
--      expired/superseded) avec adressage legacy restent valides sans discriminateur — on ne réécrit ni ne
--      supprime jamais d'historique clinique. Idempotent (`DROP … IF EXISTS` + `ADD`).
--
-- Prisma ne modélise pas les CHECK → invisible au drift-gate, appliqué par `migrate deploy`.

-- (1)+(2) REMÉDIATION EN UN BLOC — backfill non ambigu, puis retrait non destructif, puis TRACE IMMUABLE.
--     Les deux volumes (lignes backfillées / orphelins expirés) sont capturés (`GET DIAGNOSTICS`) et
--     journalisés à la fois via `RAISE NOTICE` (logs de déploiement) ET via un enregistrement `audit_logs`
--     (durable, immuable par trigger, requêtable — traçabilité HDS §IV.3 / RGPD Art. 5-2 d'une modification
--     de masse sur des données de décision clinique ; cf. ADR #18). Événement SYSTÈME (`user_id` NULL).
DO $$
DECLARE
  n_backfilled int;
  n_orphans    int;
BEGIN
  -- (1) BACKFILL NON DESTRUCTIF, NON AMBIGU : rattacher `pump_basal_slot_id` depuis le créneau POMPE du
  --     patient dont l'heure de début matche `time_slot_start_hour`, UNIQUEMENT s'il n'existe pas de second
  --     créneau du même patient dans la même heure (garde anti-mésdosage). Filtré `bc.config_type = 'pump'`
  --     (`upsertBasalConfig` ne purge pas les `pump_basal_slots` lors d'un switch pompe→stylo : sans ce
  --     filtre, un patient passé en MDI pourrait voir un orphelin rattaché à un créneau pompe PÉRIMÉ).
  --     Scopé `status = 'pending'` : on ne touche JAMAIS l'historique clinique (les lignes terminales
  --     orphelines restent valides — le CHECK (3) ne les contraint pas). `time_slot_start_hour` NULL ⇒
  --     aucun match ⇒ pas de backfill (l'orphelin est traité en (2)).
  UPDATE "adjustment_proposals" ap
  SET "pump_basal_slot_id" = pbs."id"
  FROM "pump_basal_slots" pbs
    JOIN "basal_configurations" bc ON pbs."basal_config_id" = bc."id"
    JOIN "insulin_therapy_settings" its ON bc."settings_id" = its."id"
  WHERE ap."parameter_type" = 'basalRate'
    AND ap."status" = 'pending'
    AND ap."pump_basal_slot_id" IS NULL
    AND ap."basal_dose_kind" IS NULL
    AND ap."time_slot_start_hour" IS NOT NULL
    AND bc."config_type" = 'pump'
    AND its."patient_id" = ap."patient_id"
    AND EXTRACT(HOUR FROM pbs."start_time")::int = ap."time_slot_start_hour"
    -- Anti-ambiguïté : pas d'autre créneau POMPE du même patient dans la même heure.
    AND NOT EXISTS (
      SELECT 1
      FROM "pump_basal_slots" pbs2
        JOIN "basal_configurations" bc2 ON pbs2."basal_config_id" = bc2."id"
        JOIN "insulin_therapy_settings" its2 ON bc2."settings_id" = its2."id"
      WHERE its2."patient_id" = ap."patient_id"
        AND bc2."config_type" = 'pump'
        AND EXTRACT(HOUR FROM pbs2."start_time")::int = ap."time_slot_start_hour"
        AND pbs2."id" <> pbs."id"
    );
  GET DIAGNOSTICS n_backfilled = ROW_COUNT;

  -- (2) RETRAIT NON DESTRUCTIF des orphelins `pending` restants. On passe `expired` (statut terminal) au
  --     lieu de DELETE : le CHECK scopé `pending` (3) ne contraint alors plus ces lignes, sans perte
  --     d'enregistrement ni cascade sur les accusés/consentements (`AdjustmentProposalAck`,
  --     `AdjustmentProposalActualization`, tous deux `onDelete: Cascade`).
  UPDATE "adjustment_proposals"
  SET "status" = 'expired'
  WHERE "parameter_type" = 'basalRate'
    AND "status" = 'pending'
    AND "pump_basal_slot_id" IS NULL
    AND "basal_dose_kind" IS NULL;
  GET DIAGNOSTICS n_orphans = ROW_COUNT;

  RAISE NOTICE 'US-2659 S0b — basalRate pending backfillés: %, orphelins sans cible expirés: %', n_backfilled, n_orphans;

  -- Trace immuable de la modification de masse (INSERT autorisé par le trigger d'immutabilité — il ne
  -- bloque que UPDATE/DELETE). `id`/`created_at` : la table n'a pas de default DB sur `id` → généré ici.
  -- Aucun PHI : uniquement des compteurs et l'identité de la migration.
  INSERT INTO "audit_logs" ("id", "user_id", "action", "resource", "resource_id", "metadata")
  VALUES (
    gen_random_uuid()::text,
    NULL,
    'DATA_REMEDIATION',
    'ADJUSTMENT_PROPOSAL',
    '20260724100000_us2659_s0b_basal_target_check',
    jsonb_build_object(
      'migration', '20260724100000_us2659_s0b_basal_target_check',
      'us', 'US-2659-S0b',
      'backfilledCount', n_backfilled,
      'expiredCount', n_orphans
    )
  );
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
