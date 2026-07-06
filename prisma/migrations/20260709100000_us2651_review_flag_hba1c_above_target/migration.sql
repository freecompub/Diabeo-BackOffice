-- US-2651 (mode c) — nouveau flag d'orientation : HbA1c récente au-dessus de la cible
-- (comble le trou BGM-only). `ALTER TYPE ... ADD VALUE` : hors bloc transactionnel, valeur non
-- utilisable dans la même migration → fichier dédié à une seule instruction. Non idempotent en soi
-- (le tracking `_prisma_migrations` garantit le non-rejeu). Mirroir des migrations enum US-2651/2653.
ALTER TYPE "ClinicalReviewFlagType" ADD VALUE 'hba1cAboveTarget';
