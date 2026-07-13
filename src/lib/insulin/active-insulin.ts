/**
 * @module insulin/active-insulin
 * @description US-2663 (S3d, revue architecture) — Prédicat SQL « insuline ACTIVE » (source UNIQUE).
 *
 * Une `PatientInsulin` DISCONTINUÉE (`isActive = false`, ou `endDate` passée) conserve ses `FixedDoseSlot`
 * (aucun chemin de suppression en cascade à la désactivation). Lire les doses fixes SANS ce filtre expose :
 *  - des doses **fantômes** d'insulines arrêtées à la revue / au snapshot de base ;
 *  - une **collision `(usage, moment)`** entre insuline active et arrêtée → ambiguïté fail-closed atteignable ;
 *  - pire : si le créneau de l'insuline ACTIVE a été supprimé mais celui de l'arrêtée subsiste, l'apply
 *    (résolution mono-match) **écrirait la dose sur l'insuline DISCONTINUÉE** (mésécriture silencieuse).
 *
 * Tous les lecteurs/écriveurs de `FixedDoseSlot` DOIVENT donc filtrer sur l'insuline active. Ce prédicat est
 * l'exact miroir de la garde d'affichage `treatment-view.ts` (`isActive !== false && (endDate == null ||
 * endDate + 1j > now)`) — `endDate` est date-only (`@db.Date`, minuit) donc une insuline finissant
 * « aujourd'hui » reste active tout le jour. Pas de PHI.
 */
import type { Prisma } from "@prisma/client"

/** 24 h en ms — `endDate` (date-only minuit) reste actif tout le jour de fin (inclusif). Constante PARTAGÉE
 *  (source unique) avec la garde d'affichage `treatment-view.ts` pour éviter toute dérive de l'invariant. */
export const DAY_MS = 86_400_000

/**
 * Filtre Prisma « insuline active » à spread dans un `where: { patientInsulin: { patientId, ...activeInsulinFilter() } }`.
 * @param now Instant de référence (injectable pour tests) ; défaut = maintenant.
 */
export function activeInsulinFilter(now: Date = new Date()): Prisma.PatientInsulinWhereInput {
  // `endDate + DAY_MS > now`  ⇔  `endDate > now − 1j`  (une insuline finissant aujourd'hui reste active).
  const cutoff = new Date(now.getTime() - DAY_MS)
  return { isActive: true, OR: [{ endDate: null }, { endDate: { gt: cutoff } }] }
}
