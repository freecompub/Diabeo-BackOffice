/**
 * US-2652 — Cap de variation d'une proposition **PATIENT**, PAR TYPE d'opération (fonction PURE).
 *
 * Corrige le « % seul » (`PATIENT_MAX_CHANGE_PERCENT`) mal comporté aux extrêmes : la variation autorisée
 * est `min( %type × |valeur courante| , delta absolu type )` — le plus SERRÉ, **sans plancher** (un cap
 * sous l'incrément délivrable route vers le clinicien, fail-safe). Direction : **baisse interdite** pour la
 * famille basale (pompe + dose fixe basale, risque hyper/cétose silencieuse) ; symétrique pour ISF/ICR et
 * dose fixe **bolus** (une baisse de bolus pour hypo est légitime). Pédiatrie : delta dose fixe resserré.
 *
 * Source de vérité des valeurs : `CLINICAL_BOUNDS` (reco `medical-domain-validator`, US-2652).
 * Module SANS dépendance DB — testable isolément ; l'appelant (adjustment.service) résout `capType`
 * (kind basal/bolus de la dose fixe) et `isPediatric` côté serveur.
 */
import { CLINICAL_BOUNDS as B } from "@/lib/clinical-bounds"

/** Type d'opération pour le cap patient (la dose fixe est éclatée basal/bolus). */
export type PatientCapType = "isf" | "icr" | "basalRate" | "fixedBasal" | "fixedBolus"

type CapDef = {
  pct: number
  abs: number
  /** Delta absolu resserré en mode pédiatrique (dose fixe uniquement). */
  absPediatric?: number
  /** Baisse interdite (famille basale) : monter seulement, borné en amplitude. */
  noDecrease: boolean
}

const CAP: Record<PatientCapType, CapDef> = {
  isf: { pct: B.PATIENT_MAX_CHANGE_PERCENT_ISF, abs: B.PATIENT_MAX_ABS_DELTA_ISF_GL, noDecrease: false },
  icr: { pct: B.PATIENT_MAX_CHANGE_PERCENT_ICR, abs: B.PATIENT_MAX_ABS_DELTA_ICR_GU, noDecrease: false },
  basalRate: { pct: B.PATIENT_MAX_CHANGE_PERCENT_BASAL_RATE, abs: B.PATIENT_MAX_ABS_DELTA_BASAL_RATE_U_H, noDecrease: true },
  fixedBasal: {
    pct: B.PATIENT_MAX_CHANGE_PERCENT_FIXED_BASAL,
    abs: B.PATIENT_MAX_ABS_DELTA_FIXED_BASAL_U,
    absPediatric: B.PATIENT_MAX_ABS_DELTA_FIXED_BASAL_PEDIATRIC_U,
    noDecrease: true,
  },
  fixedBolus: {
    pct: B.PATIENT_MAX_CHANGE_PERCENT_FIXED_BOLUS,
    abs: B.PATIENT_MAX_ABS_DELTA_FIXED_BOLUS_U,
    absPediatric: B.PATIENT_MAX_ABS_DELTA_FIXED_BOLUS_PEDIATRIC_U,
    noDecrease: false,
  },
}

/**
 * Dérive le `PatientCapType` d'un `AdjustableParameter`. Pour `fixedDose`, le `kind` (usage de l'insuline
 * `PatientInsulin.usage`) discrimine basal/bolus ; **`both` (pré-mélangée) → fixedBasal** (règle stricte
 * no-decrease, une pré-mélangée couvre le fond). Résolu côté serveur (jamais du body).
 * @throws unsupportedParameter si le paramètre n'est pas cappé côté patient.
 */
export function patientCapType(
  parameterType: string,
  fixedDoseKind?: "basal" | "bolus" | "both",
): PatientCapType {
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

/** Delta absolu MAX autorisé pour un changement patient = `min(% × |valeur|, delta absolu[/pédiatrie])`. */
export function patientMaxAbsDelta(capType: PatientCapType, currentValue: number, isPediatric: boolean): number {
  const c = CAP[capType]
  const abs = isPediatric && c.absPediatric != null ? c.absPediatric : c.abs
  return Math.min((c.pct / 100) * Math.abs(currentValue), abs)
}

/**
 * Vérifie qu'un changement patient respecte le cap par type. Retourne le **code d'erreur** à lever, ou
 * `null` si conforme. Tolérance FP sur la comparaison au seuil (ex. cumul flottant).
 * @returns "patientDecreaseForbidden" (baisse d'une basale) | "patientDeltaTooLarge" (amplitude) | null
 */
export function checkPatientChangeCap(
  capType: PatientCapType,
  currentValue: number,
  proposedValue: number,
  isPediatric: boolean,
): "patientDecreaseForbidden" | "patientDeltaTooLarge" | null {
  const delta = proposedValue - currentValue
  if (CAP[capType].noDecrease && delta < 0) return "patientDecreaseForbidden"
  const maxDelta = patientMaxAbsDelta(capType, currentValue, isPediatric)
  if (Math.abs(delta) > maxDelta + 1e-9) return "patientDeltaTooLarge"
  return null
}
