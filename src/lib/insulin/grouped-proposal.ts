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
 * | `fixedDose`                     | `usage`+`moment`| `{ usage, moment, value }`                       | U           |
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
import { $Enums } from "@prisma/client"

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

/**
 * Dose fixe par moment du jour (mode « doses simples », U). US-2663 (S3d) — discriminée AUSSI par l'**usage**
 * de l'insuline porteuse (`bolus`/`basal`/`both`) : un même `moment` (ex. « soir ») peut porter une dose BOLUS
 * (rapide) ET une dose BASALE (lente), sur deux `PatientInsulin` distincts. La clé de créneau est donc
 * `(usage, moment)`, pas `moment` seul — sinon l'apply ciblerait la mauvaise insuline (sur/sous-dosage).
 */
export const fixedDoseSlotSchema = z.object({
  usage: z.nativeEnum($Enums.InsulinUsage),
  moment: z.enum(["morning", "noon", "evening", "night"]),
  value: z.number().finite().nonnegative(),
})
export type FixedDoseSlot = z.infer<typeof fixedDoseSlotSchema>

/**
 * US-2663 (S3b-0a) — Rationale MOTEUR d'un créneau CHANGÉ, portée par `SlotSetProposal.rationale` (JSON) quand
 * `source = algorithm`. Reprend les métadonnées de decision-support/traçabilité HDS que le modèle par-valeur
 * (`AdjustmentProposal`) portait par créneau : le POURQUOI (`reason`), la CONFIANCE, le VOLUME d'observations.
 * **Clé d'appariement POLYMORPHE par levier** (US-2663 S3d) : `startHour` (ISF/ICR, et pompe = heure-de-début
 * dérivée) OU `(usage, moment)` (dose fixe — pas de `startHour`). Les trois champs de clé sont OPTIONNELS au
 * niveau de la FORME (le levier détermine lequel est peuplé) ; l'émetteur moteur peuple la clé pertinente et
 * l'UI de revue apparie par cette même clé. Pas de PHI (valeurs de config + métriques d'analyse). Optionnelle
 * par nature (propositions humaines sans rationale algorithmique) ; requise à la création si algorithme.
 */
export const slotRationaleSchema = z.object({
  // Clé ISF/ICR/pompe (heure-de-début, entier). Optionnelle : absente pour la dose fixe (clé `(usage, moment)`).
  startHour: z.number().int().min(0).max(23).optional(),
  // US-2663 (S3d) — clé dose fixe : usage de l'insuline porteuse + moment du jour. Absente pour ISF/ICR/pompe.
  usage: z.nativeEnum($Enums.InsulinUsage).optional(),
  moment: z.enum(["morning", "noon", "evening", "night"]).optional(),
  // US-2663 (S3b-0a, revue medical) — `reason` = enum `AdjustmentReason` (pas une chaîne libre) : il encode la
  // DIRECTION du jugement clinique (isf/icrTooLow=escalade vs TooHigh=dé-escalade), machine-vérifiable + i18n,
  // au même titre que le modèle par-valeur `AdjustmentProposal.reason`.
  reason: z.nativeEnum($Enums.AdjustmentReason),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  supportingEvents: z.number().int().nonnegative().nullable(),
  totalEventsConsidered: z.number().int().nonnegative().nullable().optional(),
  changePercent: z.number().finite().nullable().optional(),
  averageObservedValue: z.number().finite().nullable().optional(),
  analysisPeriod: z.number().int().positive().nullable().optional(),
})
  // US-2663 (S3d, revue architecture) — restaure le fail-closed de FORME affaibli par le passage à des clés
  // optionnelles : une rationale porte EXACTEMENT une clé — `startHour` (ISF/ICR/pompe) **XOR** `(usage, moment)`
  // (dose fixe). Rejette une rationale sans clé, mal-clée (`startHour` + `usage`/`moment`) ou à clé fixedDose
  // incomplète (`moment` sans `usage`) — jamais une rationale silencieusement non appariable à la revue.
  .superRefine((r, ctx) => {
    const hasHourKey = r.startHour !== undefined
    const hasFixedKey = r.usage !== undefined && r.moment !== undefined
    if (hasHourKey === hasFixedKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rationale key must be startHour XOR (usage, moment)" })
    }
  })
export type SlotRationale = z.infer<typeof slotRationaleSchema>

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
