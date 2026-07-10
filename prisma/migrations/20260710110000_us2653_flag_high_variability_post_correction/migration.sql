-- US-2653 — nouveau type de flag d'orientation contextuel (dé-escalade multi-levier).
-- ISF : moyenne post-correction haute + nadirs hypo récurrents (timing/IOB/stacking → revue, jamais une dose).
-- `ALTER TYPE ... ADD VALUE` ne peut PAS tourner dans un bloc transactionnel et la valeur ajoutée n'est
-- pas utilisable dans la même migration → fichier dédié à une seule instruction (mirroir US-2651/US-2653
-- highVariabilityPostMeal). Non idempotent en soi ; le tracking `_prisma_migrations` garantit le non-rejeu.
ALTER TYPE "ClinicalReviewFlagType" ADD VALUE 'highVariabilityPostCorrection';
