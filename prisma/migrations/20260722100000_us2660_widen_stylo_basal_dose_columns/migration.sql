-- US-2660 — Élargissement des colonnes de dose basale STYLO (MDI) de Decimal(5,2) à Decimal(6,2).
--
-- Contexte : la basale STYLO n'a pas de plafond dur (décision clinique US-2659 — U300/dégludec > 80 U
-- légitimes ; seul un WARN non bloquant à 80 U existe). Les colonnes daily/morning/eveningDose étaient
-- en NUMERIC(5,2) (max 999,99) alors que AdjustmentProposal.proposedValue est NUMERIC(8,4) : une dose
-- proposée >= 1000 U (cliniquement improbable mais non bornée) aurait déclenché un « numeric field
-- overflow » Postgres brut (500 non mappé) à l'écriture groupée de l'acceptation.
--
-- Fix : élargir à NUMERIC(6,2) (max 9999,99), aligné sur total_daily_dose déjà en (6,2). L'écriture
-- de la dose (US-2660) matche ainsi la politique « pas de cap » sans erreur DB non mappée.
--
-- Non destructif : élargissement de précision (aucune perte, aucune donnée tronquée).
ALTER TABLE "basal_configurations"
  ALTER COLUMN "daily_dose"   TYPE NUMERIC(6, 2),
  ALTER COLUMN "morning_dose" TYPE NUMERIC(6, 2),
  ALTER COLUMN "evening_dose" TYPE NUMERIC(6, 2);
