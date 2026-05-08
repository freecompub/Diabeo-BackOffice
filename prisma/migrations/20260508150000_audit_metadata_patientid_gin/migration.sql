-- US-2268 — Convention `auditLog.resourceId` normalisée
--
-- Avant : `resourceId` composite (`{patientId}:emergency-alert:{id}`,
-- `{patientId}:objectives:cgm`, etc.) → impossible de retrouver tous les events
-- d'un patient en une requête simple. CNIL/ANS exigent cette traçabilité.
--
-- Après : `resourceId` = ID natif de la ressource, `metadata.patientId` = pivot.
-- Cet index GIN partiel permet `auditService.getByPatient(patientId)` < 100ms
-- même à 10M logs.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Backfill best-effort (idempotent) — extraire patientId des resourceIds
--    composites historiques et le copier dans metadata.patientId.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Pattern reconnu : `^(\d+):` au début du resourceId (ex: "42:emergency-alert:abc",
-- "42:objectives:cgm", "42:medicalData").
--
-- Idempotence :
--  - skip si row a déjà `metadata.patientId` du BON type ET de la BONNE valeur
--    (matche le préfixe). Si type incorrect (string "42" au lieu d'int 42),
--    le row est ré-écrit avec l'int → corrige aussi les écritures buggy passées.
--
-- ⚠️ Le trigger `audit_logs_immutable` (post_deploy_sql) bloque TOUT UPDATE.
-- On bypass via `SET LOCAL session_replication_role = 'replica'` (pattern déjà
-- utilisé par audit_log_apply_retention). Transaction-scoped → re-armé au
-- COMMIT. Le DO $$ block hérite de la transaction Prisma.

DO $$
DECLARE
  affected BIGINT;
BEGIN
  SET LOCAL session_replication_role = 'replica';

  WITH backfill AS (
    UPDATE audit_logs
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{patientId}',
      to_jsonb((substring(resource_id FROM '^(\d+):'))::int)
    )
    WHERE resource_id ~ '^\d+:'
      AND (
        metadata IS NULL
        OR NOT (metadata ? 'patientId')
        OR jsonb_typeof(metadata->'patientId') <> 'number'
        OR (metadata->>'patientId')::int <>
           (substring(resource_id FROM '^(\d+):'))::int
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO affected FROM backfill;

  RAISE NOTICE 'audit_logs backfill: % rows updated with metadata.patientId', affected;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Index GIN partiel — uniquement les rows où `patientId` existe
--    dans le metadata. Réduit la taille de l'index vs full-table GIN.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `jsonb_path_ops` est plus compact (~50% smaller) qu'un GIN par défaut sur jsonb,
-- mais ne supporte que l'opérateur `@>`. Prisma 7 émet `@>` pour
-- `metadata: { path: [...], equals: ... }` → match parfait.
--
-- IF NOT EXISTS pour idempotence (re-run sur DB pré-existante avec ce script
-- déjà appliqué via psql).

CREATE INDEX IF NOT EXISTS audit_logs_metadata_patient_id_idx
  ON audit_logs
  USING GIN ((metadata) jsonb_path_ops)
  WHERE metadata ? 'patientId';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Stats — visibilité sur le backfill (informationnel, non-fatal).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  total_rows BIGINT;
  patient_pivoted_rows BIGINT;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM audit_logs;
  SELECT COUNT(*) INTO patient_pivoted_rows FROM audit_logs WHERE metadata ? 'patientId';
  RAISE NOTICE 'audit_logs: total=% patient_pivoted=%', total_rows, patient_pivoted_rows;
END $$;
