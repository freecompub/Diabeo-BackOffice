/**
 * @module insulin/grouped-proposal
 * @description US-2663 (S0) — Typage de la **disposition GROUPÉE** d'une proposition d'ajustement.
 *
 * Épic « proposition groupée intégrale » : toute proposition (patient/infirmière/médecin/ALGORITHME)
 * porte la disposition ENTIÈRE d'un levier (jeu de créneaux complet), même si un seul créneau change.
 * Ce module est la **source de vérité de forme** du JSON `SlotSetProposal.proposedSlots` /
 * `baselineSlots` — une **union discriminée par `parameterType`** (levier) : chaque levier a sa clé de
 * diff et son encodage de valeur propres.
 *
 * | Levier (`parameterType`)        | Clé de diff     | Slot                                             | Unité       |
 * |---------------------------------|-----------------|--------------------------------------------------|-------------|
 * | `insulinSensitivityFactor` (ISF)| `startHour`     | `{ startHour, endHour, value, mealLabel? }`      | g/L·U       |
 * | `insulinToCarbRatio` (ICR)      | `startHour`     | `{ startHour, endHour, value, mealLabel? }`      | g/U         |
 * | `basalRate` **pompe**           | `startTime`     | `{ startTime, endTime, rate }`                   | U/h         |
 * | `basalRate` **stylo**           | `basalDoseKind` | `{ kind: daily/morning/evening, value }`         | U (totales) |
 * | `fixedDose`                     | `moment`        | `{ moment, value }`                              | U           |
 *
 * ⚠️ **État de généralisation** : à S0, seuls **ISF/ICR** sont réellement émis/stockés dans
 * `SlotSetProposal` (voie patient US-2657). Les schémas basale (pompe/stylo) et dose fixe sont le
 * **socle typé** consommé par le basculement du moteur (S3) et la voie manuelle groupée (S4) — validés
 * ici par des tests de forme, mais pas encore produits. Ne PAS présumer qu'une `SlotSetProposal` en base
 * porte déjà un de ces leviers avant S3.
 *
 * `baselineSlots` (snapshot de base à la génération) partage **exactement** la forme de `proposedSlots`
 * du même levier — c'est une photo de la disposition AVANT changement, pas une structure distincte.
 *
 * Pas de PHI : ce sont des **valeurs de configuration** (ratios/débits/doses), jamais des données de santé.
 *
 * @see docs/UserStory/insulinotherapie-edition/US-2663-EPIC-proposition-groupee-integrale.md
 * @see docs/clinical-logic/regles-et-constantes-diabete.md §6 (CAS par créneau = garde-fou de sûreté)
 */
import { z } from "zod"

/** Encodage horaire d'un créneau ISF/ICR : `endHour ∈ [0,23]`, passage minuit via `startHour > endHour`. */
export const isfIcrSlotSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
  value: z.number().finite().positive(),
  mealLabel: z.string().max(120).optional(),
})
export type IsfIcrSlot = z.infer<typeof isfIcrSlotSchema>

/** Créneau de basale POMPE : bornes `"HH:MM"` (minute-précis) + débit U/h. */
export const pumpBasalSlotSchema = z.object({
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM"),
  rate: z.number().finite().nonnegative(),
})
export type PumpBasalSlot = z.infer<typeof pumpBasalSlotSchema>

/** Dose de basale STYLO : discriminée par la dose visée (U TOTALES, jamais U/h). */
export const styloBasalSlotSchema = z.object({
  kind: z.enum(["daily", "morning", "evening"]),
  value: z.number().finite().nonnegative(),
})
export type StyloBasalSlot = z.infer<typeof styloBasalSlotSchema>

/** Dose fixe par moment du jour (mode « doses simples », U). */
export const fixedDoseSlotSchema = z.object({
  moment: z.enum(["morning", "noon", "evening", "night"]),
  value: z.number().finite().nonnegative(),
})
export type FixedDoseSlot = z.infer<typeof fixedDoseSlotSchema>

/** Leviers reconnus par la disposition groupée (= enum Prisma `AdjustableParameter`). */
export type GroupedParameter =
  | "insulinSensitivityFactor"
  | "insulinToCarbRatio"
  | "basalRate"
  | "fixedDose"

/**
 * Schéma de forme du jeu de créneaux pour un levier donné. `basalRate` accepte l'UNION pompe|stylo
 * (le discriminateur — `startTime` vs `kind` — distingue la modalité, comme dans `AdjustmentProposal`).
 *
 * ⚠️ **Forme uniquement** — les bornes CLINIQUES (CLINICAL_BOUNDS), la couverture (no-gap/no-overlap
 * ISF/ICR) et l'exclusivité de cible basale restent validées par les gardes cliniques dédiées
 * (`assertValidSlotSet`, moteur), jamais ici. Le jeu vide passe la forme (rejeté en aval, contrat stable).
 */
export function groupedSlotsSchema(parameterType: GroupedParameter): z.ZodType<unknown[]> {
  switch (parameterType) {
    case "insulinSensitivityFactor":
    case "insulinToCarbRatio":
      return z.array(isfIcrSlotSchema)
    case "basalRate":
      return z.array(z.union([pumpBasalSlotSchema, styloBasalSlotSchema]))
    case "fixedDose":
      return z.array(fixedDoseSlotSchema)
    default: {
      // Exhaustivité : l'ajout d'un levier à `GroupedParameter` sans branche dédiée casse ICI la compilation
      // (plutôt qu'un fallback silencieux qui accepterait une forme non validée).
      const _exhaustive: never = parameterType
      throw new Error(`Unhandled grouped parameter: ${String(_exhaustive)}`)
    }
  }
}
