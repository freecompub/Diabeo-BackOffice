-- US-2653 — nouveau type de flag d'orientation : forte variabilité post-prandiale
-- (moyenne PPG > plafond ET hypos post-repas récurrentes). Le levier ICR ne peut corriger
-- à la fois le pic et le creux → le générateur émet ce flag de REVUE au lieu d'une proposition
-- de dose. `ALTER TYPE ... ADD VALUE` ne peut PAS tourner dans un bloc transactionnel et la valeur
-- ajoutée n'est pas utilisable dans la même migration → fichier dédié à une seule instruction. Non
-- idempotent en soi (échouerait au replay) : c'est le tracking `_prisma_migrations` qui garantit le
-- non-rejeu. Mirroir de la migration enum US-2651.
ALTER TYPE "ClinicalReviewFlagType" ADD VALUE 'highVariabilityPostMeal';
