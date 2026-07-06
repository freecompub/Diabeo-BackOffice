-- US-2653 — nouveau type de flag d'orientation : forte variabilité post-prandiale
-- (moyenne PPG > plafond ET hypos post-repas récurrentes). Le levier ICR ne peut corriger
-- à la fois le pic et le creux → le générateur émet ce flag de REVUE au lieu d'une proposition
-- de dose. `ALTER TYPE ... ADD VALUE` est idempotent-safe hors transaction (non rejouable en une
-- même migration, d'où fichier dédié). Mirroir de la migration enum US-2651.
ALTER TYPE "ClinicalReviewFlagType" ADD VALUE 'highVariabilityPostMeal';
