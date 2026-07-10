/**
 * Garde de sécurité PURE sur une fenêtre glycémique, utilisée par le générateur de propositions
 * (garde hypo des analyseurs, `proposal-algorithm.ts`). **Source unique** de la détection de signal hypo
 * (évite que plusieurs implémentations dérivent — régression de sécurité silencieuse).
 *
 * Client-safe (aucune dépendance serveur ; les seuils sont purs).
 */
import { GLYCEMIA_THRESHOLDS_MGDL } from "@/lib/glycemia-thresholds"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"

const SEVERE_HYPO_GL = GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPO / 100
const LEVEL1_HYPO_GL = GLYCEMIA_THRESHOLDS_MGDL.TARGET_LOW / 100

/**
 * Garde HYPO (fenêtre) — bloque une HAUSSE d'insuline si un signal hypo récent est présent :
 *  - **une** hypo sévère (niveau 2, `< SEVERE_HYPO_GL` = 0,54 g/L) suffit (urgence) ; OU
 *  - **≥ `HYPO_LEVEL1_RECURRENCE_MIN`** hypos niveau 1 (`< LEVEL1_HYPO_GL` = 0,70 g/L) — récurrence.
 * Test glycémique pur (sans direction) : l'appelant vérifie séparément le sens « plus d'insuline ».
 */
export function hypoWindowBlocks(glucosesGl: number[]): boolean {
  const hasSevere = glucosesGl.some((g) => g < SEVERE_HYPO_GL)
  const level1 = glucosesGl.filter((g) => g < LEVEL1_HYPO_GL).length
  return hasSevere || level1 >= CLINICAL_BOUNDS.HYPO_LEVEL1_RECURRENCE_MIN
}
