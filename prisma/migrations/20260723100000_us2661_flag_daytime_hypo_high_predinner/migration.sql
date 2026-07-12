-- US-2661 — nouveau type de flag d'orientation : revue de la basale STYLO du MATIN (split_injection).
-- La dose du matin est titrée sur la glycémie PRÉ-DÎNER (signal DIURNE, garde nadirs de jour), pas sur
-- l'à jeun nocturne : réutiliser `nocturnalHypoHighFasting` pour cette dose affirmait un fait faux
-- (fenêtre physiologique nocturne erronée). Ce flag distinct porte le mode d'échec diurne. Libellé i18n
-- volontairement NON affirmatif (le cas « confondeur bolus-midi » ne garantit aucune hypo — medical).
-- `ALTER TYPE ... ADD VALUE` ne peut PAS tourner dans un bloc transactionnel et la valeur ajoutée n'est
-- pas utilisable dans la même migration → fichier dédié à une seule instruction. Non idempotent en soi
-- (échouerait au replay) : c'est le tracking `_prisma_migrations` qui garantit le non-rejeu. Mirroir des
-- migrations enum US-2651/US-2653.
ALTER TYPE "ClinicalReviewFlagType" ADD VALUE 'daytimeHypoHighPreDinner';
