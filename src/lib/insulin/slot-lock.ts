/**
 * US-2657 — **Verrou consultatif unifié des mutations de créneaux insuline**.
 *
 * Toute mutation d'un jeu de créneaux ISF/ICR (ou basal) d'un patient — remplacement GROUPÉ
 * (`replaceSlotSet` / `replacePumpSlotSet`, seule voie d'écriture depuis le grouped-only ADR #26) et
 * acceptation d'une `SlotSetProposal` — doit prendre CE verrou, scopé `(patient × paramètre)`. Objectif :
 * **exclusion mutuelle réelle** entre ces chemins, sans laquelle un `replaceSlotSet` (remplacement du jeu
 * complet) peut écraser silencieusement une écriture concurrente (lost-update / reversion d'une décision
 * médecin — cf. review PR #707 finding B1).
 *
 * **Variante NON BLOQUANTE** (`pg_try_advisory_xact_lock`) : si le verrou n'est pas libre *immédiatement*
 * (mutation concurrente en cours), on **n'attend pas** → l'appelant décide en **fail-closed**
 * (`slotsBusy`/409). Élimine toute attente/deadlock/timeout sous contention. Le verrou est
 * **transaction-scoped** (relâché au COMMIT/ROLLBACK, jamais fuité même sur crash). La ré-entrance native de
 * `pg_try_advisory_xact_lock` (même transaction ⇒ `true`) reste vraie mais n'est plus exploitée : aucun
 * chemin ne pré-prend le verrou puis n'appelle une seconde primitive verrouillante (l'ancien harnais
 * d'auto-application le faisait ; il a été retiré — ADR #28). Le hash 64-bit vient de `hashtextextended(key, 0)`.
 */
import type { Prisma } from "@prisma/client"

/** Paramètre à jeu de créneaux verrouillable. US-2663 (S3d) — `fixedDose` : verrou logique `(patient × param)`
 *  (pas de `settingsId` requis — les `FixedDoseSlot` pendent de `PatientInsulin`), exclut `replaceFixedDoseSet`
 *  ⇄ acceptation concurrente comme pour isf/icr/basal. */
export type SlotLockParam = "isf" | "icr" | "basal" | "fixedDose"

/**
 * Tente d'acquérir le verrou `(patient × paramètre)` pour la durée de la transaction `tx`, **sans bloquer**.
 * @returns `true` si acquis (ou déjà détenu par la même transaction), `false` si détenu par une autre.
 */
export async function tryLockInsulinSlots(
  tx: Prisma.TransactionClient,
  patientId: number,
  param: SlotLockParam,
): Promise<boolean> {
  const key = `insulin-slots:${patientId}:${param}`
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${key}::text, 0)) AS locked`
  return rows[0]?.locked === true
}
