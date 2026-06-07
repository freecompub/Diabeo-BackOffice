-- prisma-specialist F6 — listByDoctor filtre `pro: { userId }` qui se traduit
-- en WHERE pro_id = $memberId. Sans cet index, seq scan complet de la table
-- (bloquant dès quelques k patients dans le système).
CREATE INDEX "patient_referent_pro_id_idx" ON "patient_referent"("pro_id");

-- prisma-specialist F3 — index partiel sur les opt-outs explicites RGPD Art. 21.
-- Le filtre `listByDoctor` OR (privacySettings NULL) OR (gdpr_consent AND
-- share_with_providers) cherche en priorité les rows existantes qui violent la
-- condition (= patients à exclure). L'index partiel cible UNIQUEMENT les opt-outs
-- (qui devraient être minoritaires) → lookup direct au lieu d'un heap fetch sur
-- tous les patients du portefeuille. Pas déclarable via @@index Prisma (limitation
-- WHERE clause), SQL custom requis.
CREATE INDEX "user_privacy_settings_opt_out_partial_idx"
  ON "user_privacy_settings" ("user_id")
  WHERE "gdpr_consent" = FALSE OR "share_with_providers" = FALSE;
