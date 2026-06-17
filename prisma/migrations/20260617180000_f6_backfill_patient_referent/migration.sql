-- ═══════════════════════════════════════════════════════════════
-- US-2618 / F6 — Backfill PatientReferent (data-only, idempotent)
-- ═══════════════════════════════════════════════════════════════
-- L'enforcement clinique bascule de « appartenance au service » à « médecin
-- référent » (cf. src/lib/access-control.ts). Pour qu'aucun patient déjà suivi
-- ne devienne invisible à son médecin assigné, on crée un PatientReferent pour
-- les patients SANS référent, à partir du membre assigné dans PatientService
-- (member_id = référent de fait). Patients sans référent NI member_id → restent
-- fail-closed (invisibles aux médecins, seulement ADMIN) : à affecter via la
-- gestion (PR4).
--
-- Aucune modification de schéma (DDL) → drift inchangé. Idempotent :
--   - NOT EXISTS exclut les patients ayant déjà un référent ;
--   - ON CONFLICT (patient_id) DO NOTHING (contrainte @unique) ;
--   - DISTINCT ON (patient_id) choisit un seul PatientService (le plus ancien).
-- ═══════════════════════════════════════════════════════════════

INSERT INTO "patient_referent" ("patient_id", "pro_id", "service_id")
SELECT DISTINCT ON (ps."patient_id")
       ps."patient_id", ps."member_id", ps."service_id"
FROM "patient_services" ps
JOIN "patients" p ON p."id" = ps."patient_id" AND p."deleted_at" IS NULL
WHERE ps."member_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "patient_referent" pr WHERE pr."patient_id" = ps."patient_id"
  )
ORDER BY ps."patient_id", ps."created_at" ASC
ON CONFLICT ("patient_id") DO NOTHING;
