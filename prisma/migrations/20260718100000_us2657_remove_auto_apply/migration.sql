-- US-2657 — RETRAIT TOTAL de l'auto-application experte gouvernée.
--
-- Supprime toute l'infrastructure de l'auto-application : les deux tables (approbations de gouvernance +
-- registre des auto-applications), la colonne flag `patients.auto_apply` et la fonction PL/pgSQL
-- d'immutabilité DÉDIÉE à ces tables. Une soumission patient de jeu de créneaux devient TOUJOURS une
-- proposition médecin (`slot_set_proposals`) — plus jamais d'écriture automatique de la configuration.
--
-- ✅ CONSERVÉ (NON touché ici) : `patients.maturity_level` (maturité graduée), `slot_set_proposals` et ses
--    FK/CHECK (`chk_slot_set_proposal_param_type`, FK proposer/reviewer — migration 20260717100000),
--    `adjustment_proposals`, l'écran de revue médecin, le générateur de propositions.
--
-- ⚠️ DESTRUCTIF (DROP TABLE / DROP COLUMN). L'auto-application n'a JAMAIS été activée en production
--    (kill-switch global `AUTO_APPLY_GLOBALLY_ENABLED` OFF par défaut, harnais livré inerte) → les tables
--    sont vides/inertes ; aucune donnée patient exploitable n'est perdue.

-- DropTable — les FK (patient CASCADE, user RESTRICT), index et triggers d'immutabilité
-- (`governance_approvals_no_update` / `auto_apply_events_no_update`) tombent en cascade avec la table.
DROP TABLE IF EXISTS "auto_apply_events";
DROP TABLE IF EXISTS "governance_approvals";

-- DropFunction — fonction d'immutabilité DÉDIÉE aux deux tables ci-dessus (plus aucun trigger ne la
-- référence après les DROP TABLE). Invisible au drift-gate Prisma (fonction non modélisée par le schema).
DROP FUNCTION IF EXISTS prevent_governance_row_update();

-- AlterTable — retrait du flag d'activation par patient.
ALTER TABLE "patients" DROP COLUMN IF EXISTS "auto_apply";
