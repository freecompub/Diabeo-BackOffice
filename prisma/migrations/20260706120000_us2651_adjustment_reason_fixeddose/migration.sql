-- US-2651 (mode b) — nouvelles raisons d'ajustement DOSE FIXE (titration par moment).
-- AlterEnum : ADD VALUE non destructif (mirror US-2613). Chaque valeur en instruction séparée.
ALTER TYPE "AdjustmentReason" ADD VALUE 'fixedDoseTooLow';
ALTER TYPE "AdjustmentReason" ADD VALUE 'fixedDoseTooHigh';
ALTER TYPE "AdjustmentReason" ADD VALUE 'fixedDoseCorrect';
