/**
 * US-2657 (durcissement C3b) — **Verrou consultatif unifié des mutations de créneaux insuline**.
 *
 * Toute mutation d'un jeu de créneaux ISF/ICR (ou basal) d'un patient — édition DOCTOR directe
 * (`updateIsf`/`updateIcr`/`updatePumpSlot`/`replaceSlotSet`), auto-application UNITAIRE
 * (`applyExpertEditGoverned`) et GROUPÉE (`applyExpertGroupGoverned`) — doit prendre CE verrou, scopé
 * `(patient × paramètre)`. Objectif : **exclusion mutuelle réelle** entre ces chemins, sans laquelle un
 * `replaceSlotSet` (remplacement du jeu complet) peut écraser silencieusement une écriture concurrente
 * (lost-update / reversion d'une décision médecin — cf. review PR #707 finding B1).
 *
 * `pg_advisory_xact_lock` est **transaction-scoped** (relâché au COMMIT/ROLLBACK) et **ré-entrant** : une
 * primitive appelée AVEC un `externalTx` qui détient déjà le verrou le ré-acquiert sans blocage (même
 * transaction). Le hash 64-bit vient de `hashtextextended(key, 0)`.
 */
import type { Prisma } from "@prisma/client"

/** Paramètre à jeu de créneaux verrouillable. */
export type SlotLockParam = "isf" | "icr" | "basal"

/** Acquiert le verrou `(patient × paramètre)` pour la durée de la transaction `tx`. */
export async function lockInsulinSlots(
  tx: Prisma.TransactionClient,
  patientId: number,
  param: SlotLockParam,
): Promise<void> {
  const key = `insulin-slots:${patientId}:${param}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`
}
