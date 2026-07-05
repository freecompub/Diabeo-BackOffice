/**
 * US-2648b — Capability descriptor de l'édition d'insulinothérapie.
 *
 * Décrit, pour un (rôle, mode de traitement), **qui peut faire quoi** dans l'onglet
 * Traitements de la fiche patient :
 *  - `canEditDirect` : écriture DIRECTE de la config (DOCTOR ; ADMIN via bypass V1) ;
 *  - `canPropose`    : émettre une PROPOSITION validée (DOCTOR / NURSE / patient) ;
 *  - `editableParameters` : paramètres éditables **selon le mode** (fail-closed).
 *
 * ⚠️ Module **sans dépendance serveur** (types Prisma en import-type only) → importable
 * côté client sans fuite Prisma (cf. [[client-server-import-leak]]). La résolution du
 * mode (lecture DB) vit dans `treatment-mode.service.getInsulinEditCapability`.
 *
 * Le contrôle d'accès réel reste imposé par les routes (RBAC + `resolvePatientId`,
 * US-2648a) — ce descripteur ne fait que **piloter l'UI** ; il n'autorise rien par
 * lui-même.
 */
import type { Role, TreatmentMode } from "@prisma/client"
import type { TreatmentModeResult } from "@/lib/services/treatment-mode.service"

/** Paramètres d'insulinothérapie éditables via proposition/écriture (hors `fixedDose`, non câblé). */
export type EditableParameter = "insulinSensitivityFactor" | "insulinToCarbRatio" | "basalRate"

export type InsulinEditCapability = {
  mode: TreatmentMode
  /** Config complète/cohérente (cf. resolveTreatmentMode). */
  coherent: boolean
  /** Écriture directe autorisée pour ce rôle (DOCTOR, ou ADMIN via bypass PHI V1). */
  canEditDirect: boolean
  /** Proposition autorisée pour ce rôle (DOCTOR / NURSE / patient). ADMIN exclu (non clinicien). */
  canPropose: boolean
  /** Paramètres éditables compte tenu du mode (vide si non éditable ici). */
  editableParameters: EditableParameter[]
  /** Pourquoi l'édition est bloquée, le cas échéant (pour message UI). */
  blockedReason?: "incoherentConfig" | "modeNotEditable"
}

const BASAL_BOLUS_PARAMS: EditableParameter[] = [
  "insulinSensitivityFactor",
  "insulinToCarbRatio",
  "basalRate",
]

/**
 * Dérive les capacités d'édition (fonction **PURE**, testable sans DB).
 *
 * @param role Rôle de session (RBAC).
 * @param modeResult Résultat de `resolveTreatmentMode` (mode + cohérence).
 * @returns Capacités + paramètres éditables ; `blockedReason` si rien n'est éditable.
 */
export function deriveEditCapability(role: Role, modeResult: TreatmentModeResult): InsulinEditCapability {
  // Capacités liées au RÔLE (indépendantes du mode ; miroir de l'RBAC des routes US-2648a).
  const canEditDirect = role === "DOCTOR" || role === "ADMIN"
  const canPropose = role === "DOCTOR" || role === "NURSE" || role === "VIEWER"

  // Paramètres éditables liés au MODE (fail-closed) :
  //  - basalBolus : ISF/ICR/basal, mais UNIQUEMENT si la config est cohérente ;
  //  - fixedDose  : non câblé ici (discriminateur de moment manquant, US-2648/2649b) ;
  //  - nonInsulin : pas d'éditeur d'insuline (orientation via ClinicalReviewFlag ailleurs).
  let editableParameters: EditableParameter[] = []
  let blockedReason: InsulinEditCapability["blockedReason"]

  if (modeResult.mode === "basalBolus") {
    if (modeResult.coherent) editableParameters = BASAL_BOLUS_PARAMS
    else blockedReason = "incoherentConfig"
  } else {
    blockedReason = "modeNotEditable"
  }

  return {
    mode: modeResult.mode,
    coherent: modeResult.coherent,
    canEditDirect,
    canPropose,
    editableParameters,
    blockedReason,
  }
}
