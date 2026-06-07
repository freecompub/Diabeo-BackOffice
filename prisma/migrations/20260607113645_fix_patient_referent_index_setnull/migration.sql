-- prisma-specialist F6 — listByDoctor filtre `pro: { userId }` qui se traduit
-- en WHERE pro_id = $memberId. Sans cet index, seq scan complet de la table
-- (bloquant dès quelques k patients dans le système).
--
-- L-2 — IF NOT EXISTS : idempotence si la migration est rejouée à la main
-- (runbook incident) ; `migrate deploy` reste idempotent via son journal.
-- H-2 — pas de CONCURRENTLY ici : `prisma migrate deploy` enveloppe chaque
-- migration dans UNE transaction, où `CREATE INDEX CONCURRENTLY` est interdit
-- (« cannot run inside a transaction block »). Diabeo n'est pas en prod (ADR
-- US-2267) → tables vides au 1er deploy, lock de build négligeable. Pour un env
-- DÉJÀ peuplé : pré-créer l'index hors-bande en CONCURRENTLY (cf. docs/runbook/
-- migrations.md) AVANT le deploy, le IF NOT EXISTS le sautera ensuite.
CREATE INDEX IF NOT EXISTS "patient_referent_pro_id_idx" ON "patient_referent"("pro_id");

-- prisma-specialist F3 — index partiel sur les opt-outs explicites RGPD Art. 21.
-- Le filtre `listByDoctor` OR (privacySettings NULL) OR (gdpr_consent AND
-- share_with_providers) cherche en priorité les rows existantes qui violent la
-- condition (= patients à exclure). L'index partiel cible UNIQUEMENT les opt-outs
-- (qui devraient être minoritaires) → lookup direct au lieu d'un heap fetch sur
-- tous les patients du portefeuille. Pas déclarable via @@index Prisma (limitation
-- WHERE clause), SQL custom requis.
CREATE INDEX IF NOT EXISTS "user_privacy_settings_opt_out_partial_idx"
  ON "user_privacy_settings" ("user_id")
  WHERE "gdpr_consent" = FALSE OR "share_with_providers" = FALSE;
