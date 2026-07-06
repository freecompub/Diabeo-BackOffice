/**
 * Générateur de propositions d'ajustement (US-2651, build b — chemin ICR).
 *
 * Orchestre l'assemblage des données → les analyseurs purs (`proposal-algorithm`) → la persistance
 * moteur (`adjustmentService.createEngineProposal`). **Aucune** proposition n'est appliquée : tout
 * reste `pending`, gaté médecin (ADR #13).
 *
 * Spec de référence (deadband post-prandial, grossesse, nadir, bucketing, portes qualité) :
 * `docs/clinical-logic/algorithme-propositions-ajustement.md` §5ter.
 *
 * Périmètre de cette slice : **mode `basalBolus` uniquement**, **paramètre ICR uniquement**.
 * `fixedDose`/`nonInsulin` et les autres paramètres (ISF/basal) relèvent de slices ultérieures ;
 * la frontière MDR (`nonInsulin` → aucune dose) est de toute façon re-imposée par `createEngineProposal`.
 */
import { prisma } from "@/lib/db/client"
import { logger } from "@/lib/logger"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import { findSlotForHour } from "@/lib/insulin-slots"
import { analyzeIcrSlot } from "@/lib/proposal-algorithm"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { mealtimePattern, type JournalMeal } from "@/lib/services/meal-trends.service"
import { getCgmDefaults } from "@/lib/services/objectives.service"
import { adjustmentService } from "@/lib/services/adjustment.service"
import type { AuditContext } from "@/lib/services/patient.service"

/** Fenêtre d'analyse (14 j — standard AGP, aligné `AGP_SUFFICIENCY.MIN_DAYS`). */
const ANALYSIS_PERIOD = "14d"
/** Minimum de repas appariés par créneau (aligné `analyzeIcrSlot` + `BGM_CARNET.MIN_READINGS_PER_MOMENT`). */
const MIN_MEALS_PER_SLOT = 3

/** Résultat d'un run patient — métriques d'observabilité (aucune valeur clinique). */
export interface GenerateResult {
  created: number
  slotsConsidered: number
  mealsUsable: number
  skipped: string | null
}

const EMPTY = (skipped: string): GenerateResult => ({ created: 0, slotsConsidered: 0, mealsUsable: 0, skipped })

/**
 * Un repas est exploitable pour l'ICR si : PPG 2 h mesurée, glucides ET bolus renseignés (> 0), et
 * pré-repas **dans la bande** (sinon le bolus incluait une correction / sous-dosage → mis-attribution).
 * Le nadir manquant n'est PAS bloquant (la garde hypo repli sur la PPG 2 h).
 *
 * La borne HAUTE est **grossesse-aware** : resserrée à `ICR_PREMEAL_MAX_PREGNANCY_GL` (1,10) car la
 * cible pré-repas d'une enceinte est plus basse — sinon on contaminerait le signal ICR de la
 * population la plus à risque (validé medical, US-2651). Borne basse inchangée.
 */
function isMealUsableForIcr(m: JournalMeal, isPregnancy: boolean): boolean {
  if (m.postMgdl === null) return false
  if (m.carbs === null || m.carbs <= 0) return false
  if (m.bolus === null || m.bolus <= 0) return false
  if (m.preMgdl === null) return false
  const preGl = m.preMgdl / 100
  const maxGl = isPregnancy ? CLINICAL_BOUNDS.ICR_PREMEAL_MAX_PREGNANCY_GL : CLINICAL_BOUNDS.ICR_PREMEAL_MAX_GL
  return preGl >= CLINICAL_BOUNDS.ICR_PREMEAL_MIN_GL && preGl <= maxGl
}

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

/**
 * Codes de rejet ATTENDUS de `createEngineProposal` (fail-closed, non fatals). Tout autre message
 * est traité comme inattendu : on ne le logue PAS verbatim (défense en profondeur PHI, suivi HDS) —
 * code générique `"unexpected"` + erreur brute vers `logger.error`.
 */
const EXPECTED_SKIP = new Set([
  "baselineMovedAtPersist", "duplicatePendingProposal", "valueOutOfBounds",
  "reasonDirectionMismatch", "nonInsulinNoDose", "invalidSupportingEvents",
  "slotRequired", "currentValueNotFound", "fixedDoseNotWired",
])

export const proposalGeneratorService = {
  /**
   * Génère les propositions ICR moteur pour un patient (ne persiste que des `pending`).
   * @param patientId Patient cible.
   * @param auditUserId Acteur d'audit (le cron passe un ID système).
   * @param ctx Contexte requête (audit).
   * @returns Métriques du run (sans PHI).
   */
  async generateForPatient(patientId: number, auditUserId: number, ctx?: AuditContext): Promise<GenerateResult> {
    // 0. Mode — seul `basalBolus` a des ratios ICR par créneau à titrer.
    const { mode } = await treatmentModeService.resolveTreatmentMode(patientId)
    if (mode !== "basalBolus") return EMPTY("mode")

    // 1. Config (créneaux ICR) + patient (pathologie / grossesse pour la cible).
    const settings = await insulinTherapyService.getSettings(patientId, auditUserId, ctx)
    const carbRatios = settings?.carbRatios ?? []
    if (carbRatios.length === 0) return EMPTY("noCarbRatios")
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { pathology: true, pregnancyMode: true },
    })
    if (!patient) return EMPTY("noPatient")

    // 2. Cible post-prandiale — deadband asymétrique, pathology/grossesse-aware (§5ter).
    //    ⚠️ Un DT1 enceinte a `pathology = DT1` → il FAUT forcer les seuils grossesse.
    const isPregnancy = patient.pregnancyMode === true || patient.pathology === "GD"
    const ceilingGl = getCgmDefaults(isPregnancy ? "GD" : patient.pathology).ok
    const lowerGl = isPregnancy
      ? CLINICAL_BOUNDS.POSTPRANDIAL_TITRATION_LOW_PREGNANCY_GL
      : CLINICAL_BOUNDS.POSTPRANDIAL_TITRATION_LOW_GL

    // 3. Repas (14 j, CGM) → portes qualité.
    const journal = await mealtimePattern.dailyJournal(patientId, ANALYSIS_PERIOD, auditUserId, ctx, { source: "cgm" })
    const usable = journal.filter((m) => isMealUsableForIcr(m, isPregnancy))

    // 4. Bucketing par créneau ICR à l'HEURE RÉELLE du repas (pas le moment).
    const slots = carbRatios.map((c) => ({ startHour: c.startHour, endHour: c.endHour, gramsPerUnit: Number(c.gramsPerUnit) }))
    const bySlot = new Map<string, { slot: (typeof slots)[number]; meals: JournalMeal[] }>()
    for (const m of usable) {
      const slot = findSlotForHour(slots, m.localHour)
      if (!slot) continue
      const key = `${slot.startHour}-${slot.endHour}`
      const bucket = bySlot.get(key) ?? { slot, meals: [] }
      bucket.meals.push(m)
      bySlot.set(key, bucket)
    }

    // 5. Par créneau ≥ 3 repas → deadband → analyseur → persistance moteur.
    let created = 0
    let slotsConsidered = 0
    for (const { slot, meals } of bySlot.values()) {
      if (meals.length < MIN_MEALS_PER_SLOT) continue
      slotsConsidered++

      const avgPostGl = mean(meals.map((m) => m.postMgdl! / 100))
      // Deadband asymétrique : au-dessus du plafond → BAISSE ICR (plus d'insuline) ; en dessous de la
      // borne basse → HAUSSE ICR (moins d'insuline) ; entre les deux → aucune proposition.
      let targetGl: number | null = null
      if (avgPostGl > ceilingGl) targetGl = ceilingGl
      else if (avgPostGl < lowerGl) targetGl = lowerGl
      if (targetGl === null) continue

      const candidate = analyzeIcrSlot(slot, meals.map((m) => ({
        postGlucoseGl: m.postMgdl! / 100,
        targetGl,
        nadirGl: m.nadirMgdl !== null ? m.nadirMgdl / 100 : undefined,
      })))
      if (!candidate) continue

      try {
        await adjustmentService.createEngineProposal({
          patientId,
          parameterType: "insulinToCarbRatio",
          proposedValue: candidate.proposedValue,
          expectedCurrentValue: candidate.currentValue,
          reason: candidate.reason,
          confidence: candidate.confidence,
          supportingEvents: candidate.supportingEvents,
          totalEventsConsidered: candidate.totalEventsConsidered,
          averageObservedValue: candidate.averageObservedValue ?? null,
          analysisPeriod: ANALYSIS_PERIOD,
          carbRatioSlotStart: slot.startHour,
          carbRatioSlotEnd: slot.endHour,
        }, ctx)
        created++
      } catch (err) {
        // Rejets ATTENDUS (fail-closed, non fatals) → info + grep SOC ; on continue le portefeuille.
        // INATTENDU (ex. erreur DB brute) → logger.error SANS interpoler le message (défense PHI, HDS #671).
        const msg = (err as Error).message
        const bucket = `${slot.startHour}-${slot.endHour}`
        if (EXPECTED_SKIP.has(msg)) {
          logger.info("proposal-generator", "engine proposal skipped", { patientId, bucket, failMode: msg })
        } else {
          logger.error("proposal-generator", "unexpected engine proposal error",
            { patientId, bucket, failMode: "unexpected" }, err as Error)
        }
      }
    }

    return { created, slotsConsidered, mealsUsable: usable.length, skipped: null }
  },
}
