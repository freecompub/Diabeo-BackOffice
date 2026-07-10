-- Élargissement de `audit_logs.action` VARCHAR(30) → VARCHAR(64).
--
-- Correction d'un bug LATENT (revue PR #714, healthcare-security-auditor) : l'action d'audit
-- `MATURITY_LEVEL_SELF_ELEVATION_DENIED` (36 caractères, US-2657 maturité — signal RBAC de tentative
-- d'auto-élévation) dépassait la borne 30 → tout insert de cette action échouait en `22001`
-- (string_data_right_truncation), faisant taire une trace de sécurité au moment le plus critique.
-- 64 = marge confortable pour tous les tokens d'action actuels/futurs.
--
-- Non destructif : élargir un VARCHAR ne réécrit pas la table (changement de métadonnée, aucune ligne
-- touchée) et ne tronque aucune donnée existante. La DDL n'est pas concernée par le trigger d'immutabilité
-- `audit_logs_immutable` (BEFORE UPDATE OR DELETE, niveau LIGNE — ne se déclenche pas sur un ALTER TABLE).

ALTER TABLE "audit_logs" ALTER COLUMN "action" SET DATA TYPE VARCHAR(64);
