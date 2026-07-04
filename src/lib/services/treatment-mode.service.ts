/**
 * US-2647 — Détection du **mode de traitement** d'un patient (épic US-2645).
 *
 * Trois modes (cf. `docs/UserStory/insulinotherapie-edition/US-2647-*.md`) :
 *  - `basalBolus`  : insulinothérapie complète (ISF **et** ICR par créneau ; pompe ou MDI).
 *  - `fixedDose`   : doses d'insuline simples/fixes (insuline active, sans ratios complets).
 *  - `nonInsulin`  : aucune insuline active (ADO/GLP-1/diététique).
 *
 * **Source de vérité = dérivation à la lecture** (cette fonction), PAS la colonne cache
 * `Patient.treatmentMode` (US-2646). Le gate d'écriture (US-2648) re-dérive dans la même
 * transaction. **Fail-closed** : un DT1 n'est JAMAIS classé `nonInsulin` (il a toujours
 * besoin d'insuline) → au minimum `fixedDose`.
 *
 * `coherent = false` (mode `basalBolus` avec trou/chevauchement de couverture 24 h) signale
 * une config à corriger AVANT toute édition/proposition (US-2648 AC-2).
 */

import type { Pathology, BasalConfigType, TreatmentMode } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { insulinService } from "@/lib/services/insulin.service"
import { analyzeSlotCoverage } from "@/lib/insulin/slot-coverage"

export type TreatmentModeResult = {
  mode: TreatmentMode
  /** false → config incohérente (mode basalBolus avec trou/chevauchement) → édition bloquée. */
  coherent: boolean
}

type HourSlot = { startHour: number; endHour: number }

export type DeriveTreatmentModeInput = {
  pathology: Pathology
  /** Créneaux ISF (facteurs de sensibilité) définis. */
  isfSlots: HourSlot[]
  /** Créneaux ICR (ratios glucidiques) définis. */
  icrSlots: HourSlot[]
  /** Au moins une ligne PatientInsulin active (usage bolus/basal/both). */
  hasActiveInsulin: boolean
  /** Type de config basale (null si absente). */
  basalConfigType: BasalConfigType | null
}

const toMinutes = (s: HourSlot) => ({ start: s.startHour * 60, end: s.endHour * 60 })

/**
 * Dérive le mode de traitement (fonction PURE, testable sans DB).
 * @see resolveTreatmentMode pour la version qui lit la base.
 */
export function deriveTreatmentMode(input: DeriveTreatmentModeInput): TreatmentModeResult {
  const { pathology, isfSlots, icrSlots, hasActiveInsulin, basalConfigType } = input

  const hasFullRatios = isfSlots.length > 0 && icrSlots.length > 0
  const isFixedBasalConfig =
    basalConfigType === "single_injection" || basalConfigType === "split_injection"
  const hasAnyInsulin =
    hasActiveInsulin ||
    isFixedBasalConfig ||
    basalConfigType === "pump" ||
    isfSlots.length > 0 ||
    icrSlots.length > 0

  // (a) Insulinothérapie complète : ISF ET ICR. Cohérente si couverture 24 h saine.
  if (hasFullRatios) {
    const isf = analyzeSlotCoverage(isfSlots.map(toMinutes))
    const icr = analyzeSlotCoverage(icrSlots.map(toMinutes))
    const coherent = !isf.hasGap && !isf.hasOverlap && !icr.hasGap && !icr.hasOverlap
    return { mode: "basalBolus", coherent }
  }

  // (b) Doses simples/fixes : insuline active mais pas de ratios complets.
  if (hasAnyInsulin) {
    return { mode: "fixedDose", coherent: true }
  }

  // (c) Aucune insuline. Fail-closed : un DT1 n'est jamais nonInsulin → fixedDose.
  if (pathology === "DT1") {
    return { mode: "fixedDose", coherent: true }
  }
  return { mode: "nonInsulin", coherent: true }
}

/**
 * Résout le mode de traitement d'un patient depuis la base (dérivation à la lecture).
 * @throws si le patient n'existe pas.
 */
export async function resolveTreatmentMode(patientId: number): Promise<TreatmentModeResult> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { pathology: true },
  })
  if (!patient) throw new Error("patientNotFound")

  const [settings, activeInsulin] = await Promise.all([
    insulinService.getSettings(patientId),
    prisma.patientInsulin.findFirst({
      where: { patientId, isActive: true, usage: { in: ["bolus", "basal", "both"] } },
      select: { id: true },
    }),
  ])

  return deriveTreatmentMode({
    pathology: patient.pathology,
    isfSlots: settings?.sensitivityFactors ?? [],
    icrSlots: settings?.carbRatios ?? [],
    hasActiveInsulin: activeInsulin != null,
    basalConfigType: settings?.basalConfiguration?.configType ?? null,
  })
}

export const treatmentModeService = { deriveTreatmentMode, resolveTreatmentMode }
