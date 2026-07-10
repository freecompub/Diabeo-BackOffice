/**
 * US-2652 — Cap de variation d'une proposition **PATIENT**, PAR TYPE d'opération ET PAR TIER de patient
 * (fonction PURE).
 *
 * Variation autorisée = `min( %type × |valeur courante| , delta absolu[tier][type] )` — le plus SERRÉ,
 * **sans plancher** (un cap sous l'incrément délivrable route vers le clinicien, fail-safe). Le `%` reste
 * uniforme (10 %) ; le **delta absolu varie par type ET par tier** (pédiatrie/grossesse/standard/résistant) :
 * la résistance à l'insuline augmente les doses délivrées → un pas de titration significatif y est plus grand
 * en unités réelles (basale/dose fixe). Les ratios ISF/ICR restent uniformes (couplage inversé à la résistance).
 * Direction : **baisse interdite** pour la famille basale (pompe + dose fixe basale) ; symétrique pour
 * ISF/ICR et dose fixe **bolus** (baisse pour hypo légitime).
 *
 * Source des valeurs : `CLINICAL_BOUNDS` + `PATIENT_MAX_ABS_DELTA` (reco `medical-domain-validator`).
 * Module SANS dépendance DB — l'appelant (adjustment.service) résout `capType` (kind dose fixe) et `tier`
 * (pathologie + pédiatrie + grossesse) côté serveur, jamais du body.
 */
import type { Pathology } from "@prisma/client"
import {
  CLINICAL_BOUNDS as B,
  PATIENT_MAX_ABS_DELTA,
  type PatientCapType,
  type PatientCapTier,
} from "@/lib/clinical-bounds"

export type { PatientCapType, PatientCapTier }

/** % du cap par type (uniforme 10 % aujourd'hui ; per-type pour divergence future). */
const PCT: Record<PatientCapType, number> = {
  isf: B.PATIENT_MAX_CHANGE_PERCENT_ISF,
  icr: B.PATIENT_MAX_CHANGE_PERCENT_ICR,
  basalRate: B.PATIENT_MAX_CHANGE_PERCENT_BASAL_RATE,
  fixedBasal: B.PATIENT_MAX_CHANGE_PERCENT_FIXED_BASAL,
  fixedBolus: B.PATIENT_MAX_CHANGE_PERCENT_FIXED_BOLUS,
}

/** Baisse interdite (famille basale : risque hyper/cétose silencieuse). */
const NO_DECREASE: Record<PatientCapType, boolean> = {
  isf: false,
  icr: false,
  basalRate: true,
  fixedBasal: true,
  fixedBolus: false,
}

/**
 * Résout le **tier de patient** par cascade **le plus strict gagne**, à partir de signaux résolus SERVEUR
 * (jamais du body). `isPregnant` = `pregnancyMode || pathology === "GD"` (calculé par l'appelant).
 */
export function resolvePatientCapTier(pathology: Pathology, isPediatric: boolean, isPregnant: boolean): PatientCapTier {
  if (isPediatric) return "PEDIATRIC"
  if (isPregnant) return "PREGNANCY"
  if (pathology === "DT2") return "RESISTANT"
  return "STANDARD"
}

/**
 * Dérive le `PatientCapType` d'un `AdjustableParameter`. Pour `fixedDose`, le `kind` (`PatientInsulin.usage`)
 * discrimine basal/bolus ; **`both` (pré-mélangée) → fixedBasal** (règle stricte no-decrease). Résolu serveur.
 * @throws unsupportedParameter si le paramètre n'est pas cappé côté patient.
 */
export function patientCapType(parameterType: string, fixedDoseKind?: "basal" | "bolus" | "both"): PatientCapType {
  switch (parameterType) {
    case "insulinSensitivityFactor":
      return "isf"
    case "insulinToCarbRatio":
      return "icr"
    case "basalRate":
      return "basalRate"
    case "fixedDose":
      return fixedDoseKind === "bolus" ? "fixedBolus" : "fixedBasal"
    default:
      throw new Error("unsupportedParameter")
  }
}

/** Delta absolu MAX autorisé pour un changement patient = `min(% × |valeur|, abs[tier][type])`. */
export function patientMaxAbsDelta(capType: PatientCapType, currentValue: number, tier: PatientCapTier): number {
  return Math.min((PCT[capType] / 100) * Math.abs(currentValue), PATIENT_MAX_ABS_DELTA[tier][capType])
}

/**
 * Vérifie qu'un changement patient respecte le cap. Retourne le **code d'erreur** à lever, ou `null` si
 * conforme. Tolérance FP sur la comparaison au seuil.
 * @returns "patientDecreaseForbidden" (baisse d'une basale) | "patientDeltaTooLarge" (amplitude) | null
 */
export function checkPatientChangeCap(
  capType: PatientCapType,
  currentValue: number,
  proposedValue: number,
  tier: PatientCapTier,
): "patientDecreaseForbidden" | "patientDeltaTooLarge" | null {
  const delta = proposedValue - currentValue
  if (NO_DECREASE[capType] && delta < 0) return "patientDecreaseForbidden"
  const maxDelta = patientMaxAbsDelta(capType, currentValue, tier)
  if (Math.abs(delta) > maxDelta + 1e-9) return "patientDeltaTooLarge"
  return null
}
