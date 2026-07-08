/**
 * US-2657 (slice A2) — Logique PURE du changement de niveau de maturité (testable sans i18n/DOM).
 * Détermine le sens du changement et la clé i18n du message de confirmation.
 */
import type { MaturityLevel } from "@prisma/client"

/** Ordre des crans (pour comparer montée / descente). */
export const MATURITY_RANK: Record<MaturityLevel, number> = { JUNIOR: 0, INTERMEDIATE: 1, EXPERT: 2 }

/**
 * Clé i18n du message de confirmation selon le sens du changement :
 *  - **montée vers EXPERT** → capacité « refuser / contre-proposer » ;
 *  - **montée** (vers INTERMEDIATE) → capacité « restructurer les créneaux » ;
 *  - **descente** → note de retrait de capacités (+ neutralisation auto-application ultérieure).
 */
export function maturityChangeMessageKey(from: MaturityLevel, to: MaturityLevel): string {
  if (MATURITY_RANK[to] > MATURITY_RANK[from]) {
    return to === "EXPERT" ? "maturityGrantExpert" : "maturityGrantSlots"
  }
  return "maturityDowngradeNote"
}
