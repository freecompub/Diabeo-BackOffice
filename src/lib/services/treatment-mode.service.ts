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
 * `coherent` = la config est **complète et cohérente, prête pour une proposition**.
 * `coherent = false` = config **à revoir/configurer** avant toute édition/proposition (US-2648 AC-2) :
 * trou/chevauchement de couverture 24 h (ISF/ICR, ou basale pompe), config **périmée**
 * (ratios sans insuline active), **incomplète** (pompe sans ratios, ratios partiels), ou
 * **vidée** chez un patient DT1 / ayant déjà eu de l'insuline (fail-closed).
 * NB : `coherent` ne décide pas seul « éditable » — c'est au gate d'écriture (US-2648) de
 * combiner `{mode, coherent}` (mode `basalBolus` exige `coherent`, les autres ont leurs règles).
 */

import type { Pathology, BasalConfigType, TreatmentMode, Role } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { insulinService } from "@/lib/services/insulin.service"
import { analyzeSlotCoverage, timeToMinutes } from "@/lib/insulin/slot-coverage"
import { deriveEditCapability, type InsulinEditCapability } from "@/lib/insulin/edit-capability"

export type TreatmentModeResult = {
  mode: TreatmentMode
  /** false → config à revoir/configurer (trou/chevauchement, périmée, incomplète, vidée) → édition à débloquer par un PS. */
  coherent: boolean
}

type HourSlot = { startHour: number; endHour: number }
type MinuteSlot = { start: number; end: number }

export type DeriveTreatmentModeInput = {
  pathology: Pathology
  /** Créneaux ISF (facteurs de sensibilité) définis. */
  isfSlots: HourSlot[]
  /** Créneaux ICR (ratios glucidiques) définis. */
  icrSlots: HourSlot[]
  /** Au moins une ligne PatientInsulin active (usage bolus/basal/both). */
  hasActiveInsulin: boolean
  /**
   * Le patient a-t-il **déjà** eu de l'insuline (ligne PatientInsulin active OU inactive) ?
   * Fail-closed : une config vidée (lignes désactivées) ne doit pas être lue comme
   * « non insuliné » — un DT2/GD sous insuline puis config effacée reste à revoir.
   */
  hadInsulinEver: boolean
  /** Type de config basale (null si absente). */
  basalConfigType: BasalConfigType | null
  /** Créneaux basaux pompe **déjà convertis en minutes** [0,1440] (couverture 24 h). */
  basalSlots: MinuteSlot[]
}

const toMinutes = (s: HourSlot): MinuteSlot => ({ start: s.startHour * 60, end: s.endHour * 60 })

/**
 * Dérive le mode de traitement (fonction PURE, testable sans DB).
 * @see resolveTreatmentMode pour la version qui lit la base.
 */
export function deriveTreatmentMode(input: DeriveTreatmentModeInput): TreatmentModeResult {
  const { pathology, isfSlots, icrSlots, hasActiveInsulin, hadInsulinEver, basalConfigType, basalSlots } = input

  const hasFullRatios = isfSlots.length > 0 && icrSlots.length > 0
  const hasPartialRatios = isfSlots.length > 0 || icrSlots.length > 0
  const isPump = basalConfigType === "pump"
  const isFixedBasalConfig =
    basalConfigType === "single_injection" || basalConfigType === "split_injection"

  const noGapNoOverlap = (c: { hasGap: boolean; hasOverlap: boolean }) => !c.hasGap && !c.hasOverlap

  // (a) Insulinothérapie complète : ISF ET ICR. `coherent` = config prête pour proposition :
  //   - couverture 24 h ISF/ICR saine (ni trou ni chevauchement) ;
  //   - pour une pompe : couverture basale 24 h saine aussi (US-2647 revue) ;
  //   - NON périmée : au moins une insuline active (ratios sans insuline active = droits périmés).
  if (hasFullRatios) {
    const ratioOk =
      noGapNoOverlap(analyzeSlotCoverage(isfSlots.map(toMinutes))) &&
      noGapNoOverlap(analyzeSlotCoverage(icrSlots.map(toMinutes)))
    const basalOk = isPump ? noGapNoOverlap(analyzeSlotCoverage(basalSlots)) : true
    return { mode: "basalBolus", coherent: ratioOk && basalOk && hasActiveInsulin }
  }

  // (b) Doses simples/fixes RÉELLES : insuline active ou schéma basal fixe (1-2 injections).
  if (hasActiveInsulin || isFixedBasalConfig) {
    return { mode: "fixedDose", coherent: true }
  }

  // Config INCOMPLÈTE (à configurer) : pompe sans ratios, ou ratios partiels sans insuline active.
  // → mode fixedDose (fail-closed) mais `coherent=false` (édition/proposition à débloquer par un PS).
  if (isPump || hasPartialRatios) {
    return { mode: "fixedDose", coherent: false }
  }

  // (c) Aucune config d'insuline. Fail-closed : un DT1 — ou tout patient ayant DÉJÀ eu de
  // l'insuline (config vidée) — n'est JAMAIS `nonInsulin` → `fixedDose` à revoir (coherent=false).
  if (pathology === "DT1" || hadInsulinEver) {
    return { mode: "fixedDose", coherent: false }
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

  const [settings, activeInsulin, anyInsulin] = await Promise.all([
    insulinService.getSettings(patientId),
    prisma.patientInsulin.findFirst({
      where: { patientId, isActive: true, usage: { in: ["bolus", "basal", "both"] } },
      select: { id: true },
    }),
    // hadInsulinEver — toute ligne PatientInsulin (active OU inactive) : une config vidée
    // (lignes désactivées) reste détectée → fail-closed contre un faux « non insuliné ».
    prisma.patientInsulin.findFirst({ where: { patientId }, select: { id: true } }),
  ])

  const basalSlots = (settings?.basalConfiguration?.pumpSlots ?? [])
    .map((p) => ({ start: timeToMinutes(p.startTime), end: timeToMinutes(p.endTime) }))
    .filter((s): s is { start: number; end: number } => s.start !== null && s.end !== null)

  return deriveTreatmentMode({
    pathology: patient.pathology,
    isfSlots: settings?.sensitivityFactors ?? [],
    icrSlots: settings?.carbRatios ?? [],
    hasActiveInsulin: activeInsulin != null,
    hadInsulinEver: anyInsulin != null,
    basalConfigType: settings?.basalConfiguration?.configType ?? null,
    basalSlots,
  })
}

/**
 * US-2648b — Résout le **capability descriptor** d'édition insuline pour un (rôle, patient) :
 * mode de traitement (lu en base) + capacités RBAC + paramètres éditables. Pilote l'UI de
 * l'onglet Traitements ; n'autorise rien par lui-même (le RBAC réel est aux routes, US-2648a).
 *
 * @param role Rôle de session.
 * @param patientId Patient déjà résolu/autorisé par la route (`resolvePatientId`).
 * @throws `patientNotFound` si le patient n'existe pas (via `resolveTreatmentMode`).
 */
export async function getInsulinEditCapability(role: Role, patientId: number): Promise<InsulinEditCapability> {
  const modeResult = await resolveTreatmentMode(patientId)
  return deriveEditCapability(role, modeResult)
}

export const treatmentModeService = { deriveTreatmentMode, resolveTreatmentMode, getInsulinEditCapability }
