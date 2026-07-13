/**
 * @module insulin/proposal-coexistence
 * @description US-2663 (S3b-0b) — Indice de COEXISTENCE entre propositions GROUPÉES `pending` du même
 * paramètre, pour l'écran de revue médecin (`/patients/[id]/review`, `GroupedProposalReview`).
 *
 * Rappel décision produit D2 (`slot-set-proposal.service.ts` `createSetProposal`) : la supersession à la
 * création est appliquée PAR CLASSE D'ORIGINE — l'ALGORITHME ne supersède que l'algorithme, l'HUMAIN
 * (patient/infirmier/médecin) ne supersède que l'humain. Il en résulte qu'au plus **une** proposition
 * ALGORITHME et **une** proposition HUMAINE peuvent être `pending` **simultanément** sur le même
 * `(patient × parameterType)` — le médecin voit alors les DEUX et arbitre.
 *
 * Ce module calcule, PUREMENT (aucune I/O), pour chaque proposition d'une liste candidate, la provenance
 * d'une éventuelle proposition SŒUR (même `parameterType`, classe d'origine différente) — pour que l'écran de
 * revue puisse afficher un bandeau « une autre proposition existe sur ce paramètre ».
 *
 * @see src/lib/services/slot-set-proposal.service.ts (`createSetProposal`, supersession par classe d'origine)
 * @see docs/UserStory/insulinotherapie-edition/US-2663-EPIC-proposition-groupee-integrale.md (S3b-0b)
 */
import type { ProposalSource } from "@prisma/client"

/** Champs minimaux nécessaires au calcul de coexistence (sur-ensemble compatible avec `SlotSetProposal`). */
export type CoexistenceCandidate = {
  id: string
  parameterType: string
  source: ProposalSource
}

/** `true` si la provenance appartient à la classe ALGORITHME (vs classe HUMAINE : patient/infirmier/médecin). */
const isAlgorithmClass = (source: ProposalSource): boolean => source === "algorithm"

/**
 * Calcule, pour chaque candidat, la provenance de la proposition SŒUR (même `parameterType`, classe
 * d'origine différente) dans la même liste — `null` si aucune coexistence. La liste candidate est censée être
 * scopée à un seul patient (les `id` sont supposés uniques) et à un seul statut (`pending`) : c'est à
 * l'appelant (`page.tsx`, via `listPendingForReview`) de fournir la bonne liste.
 *
 * Pure — aucune requête, aucune mutation. Complexité O(n²) volontairement acceptée : la file de propositions
 * `pending` d'un patient est courte par construction (au plus 1 humain + 1 algorithme par paramètre, garanti
 * par les index uniques partiels).
 *
 * @returns une `Map<id, ProposalSource | null>` — une entrée par candidat en entrée.
 */
export function deriveCoexistsWith(
  candidates: readonly CoexistenceCandidate[],
): Map<string, ProposalSource | null> {
  const result = new Map<string, ProposalSource | null>()
  for (const candidate of candidates) {
    const sibling = candidates.find(
      (other) =>
        other.id !== candidate.id &&
        other.parameterType === candidate.parameterType &&
        isAlgorithmClass(other.source) !== isAlgorithmClass(candidate.source),
    )
    result.set(candidate.id, sibling ? sibling.source : null)
  }
  return result
}
