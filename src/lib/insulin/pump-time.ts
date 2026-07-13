/**
 * @module insulin/pump-time
 * @description US-2663 (S3c) — Source UNIQUE de la conversion « ligne `PumpBasalSlot` DB → forme groupée ».
 *
 * La disposition groupée basale POMPE (`PumpBasalSlot` de `grouped-proposal.ts`) encode les bornes en `"HH:MM"`
 * (colonne DB `Time`, `1970-01-01THH:MM:00Z`) et le débit en `number` (colonne `Decimal(5,3)`). Ce mapping est
 * consommé à ≥ 4 endroits (`captureBaselineSlots`, `emitGroupedPumpBasal`, `replacePumpSlotSet` CAS/audit, la
 * page de revue `livePump`) — le centraliser ici **verrouille l'invariant de forme** (baseline ⇄ overlay ⇄
 * apply ⇄ affichage doivent produire EXACTEMENT la même projection, sinon un faux `baselineMoved` ou un temps
 * réécrit). Pas de PHI : ce sont des valeurs de configuration (débits/horaires), jamais une donnée de santé.
 */
import type { PumpBasalSlot } from "@/lib/insulin/grouped-proposal"

/** Colonne `Time` (`1970-01-01THH:MM:00Z`) → `"HH:MM"` (minute-précis, EXACT — jamais tronqué à l'heure). */
export const pumpTimeToHhmm = (t: Date): string => t.toISOString().slice(11, 16)

/**
 * Une ligne `PumpBasalSlot` DB (`startTime`/`endTime` `Date`, `rate` `Decimal`|`number`) → forme groupée
 * `PumpBasalSlot` (`{ startTime, endTime, rate }`). L'`id` de créneau (si sélectionné) est ajouté séparément
 * par l'appelant qui en a besoin (appariement candidat⇄live du moteur), hors de cet invariant de forme.
 */
export function pumpRowToGroupedSlot(row: { startTime: Date; endTime: Date; rate: unknown }): PumpBasalSlot {
  return { startTime: pumpTimeToHhmm(row.startTime), endTime: pumpTimeToHhmm(row.endTime), rate: Number(row.rate) }
}
