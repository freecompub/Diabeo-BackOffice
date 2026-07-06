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
import { withSessionAdvisoryLock } from "@/lib/db/cron-lock"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import { findSlotForHour } from "@/lib/insulin-slots"
import {
  analyzeIcrSlot, analyzeIcrHypoDeescalation, recurrentPostMealHypo, type ProposalCandidate,
} from "@/lib/proposal-algorithm"
import { clinicalReviewFlagService } from "@/lib/services/clinical-review-flag.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { mealtimePattern, type JournalMeal } from "@/lib/services/meal-trends.service"
import { getCgmDefaults } from "@/lib/services/objectives.service"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { auditService } from "@/lib/services/audit.service"
import type { AuditContext } from "@/lib/services/patient.service"

/** Fenêtre d'analyse (14 j — standard AGP, aligné `AGP_SUFFICIENCY.MIN_DAYS`). */
const ANALYSIS_PERIOD = "14d"
/** Minimum de repas appariés par créneau (aligné `analyzeIcrSlot` + `BGM_CARNET.MIN_READINGS_PER_MOMENT`). */
const MIN_MEALS_PER_SLOT = 3

/** Résultat d'un run patient — métriques d'observabilité (aucune valeur clinique). */
export interface GenerateResult {
  created: number
  /** US-2653 — flags `highVariabilityPostMeal` levés (cas haute-variabilité, jamais de dose). */
  flagged: number
  slotsConsidered: number
  mealsUsable: number
  skipped: string | null
}

/** Résultat d'un run PORTEFEUILLE (cron) — métriques agrégées, aucune valeur clinique. */
export interface GenerateAllResult {
  processed: number
  created: number
  flagged: number
  errored: number
  skippedConcurrent: boolean
}

/** Acteur d'audit du cron = acteur SYSTÈME (`null`, FK-safe) — cohérent avec `createEngineProposal`
 *  (userId null) et les autres crons. Les lectures (`getSettings`/`dailyJournal`) sont donc attribuées
 *  au système, pas à un soignant. */
const CRON_AUDIT_USER_ID: number | null = null
/** Clé du verrou advisory global (anti double-run OVH + Vercel). */
const CRON_LOCK_KEY = "proposal-generator-cron"

const EMPTY = (skipped: string): GenerateResult =>
  ({ created: 0, flagged: 0, slotsConsidered: 0, mealsUsable: 0, skipped })

/** Construit les entrées `analyzeIcrSlot` d'un créneau pour une cible donnée (deadband). */
const buildIcrMeals = (meals: JournalMeal[], targetGl: number) =>
  meals.map((m) => ({
    postGlucoseGl: m.postMgdl! / 100,
    targetGl,
    nadirGl: m.nadirMgdl !== null ? m.nadirMgdl / 100 : undefined,
  }))

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
  async generateForPatient(patientId: number, auditUserId: number | null, ctx?: AuditContext): Promise<GenerateResult> {
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

    // 5. Par créneau ≥ 3 repas → MATRICE DE DÉCISION (§5ter, validée medical US-2653) :
    //    moyenne PPG × hypo récurrente (nadirs). Deadband et dé-escalade sont mutuellement exclusifs
    //    par créneau. Cas HAUTE-VARIABILITÉ (moyenne > plafond ET hypos récurrentes) → FLAG de revue,
    //    JAMAIS une dose (le levier ICR ne corrige pas à la fois le pic et le creux).
    let created = 0
    let flagged = 0
    let slotsConsidered = 0

    // Persiste un candidat (deadband ou dé-escalade). Rejets fail-closed logués + non fatals.
    const persist = async (candidate: ProposalCandidate, slot: (typeof slots)[number]): Promise<boolean> => {
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
        return true
      } catch (err) {
        const msg = (err as Error).message
        const bucket = `${slot.startHour}-${slot.endHour}`
        if (EXPECTED_SKIP.has(msg)) {
          logger.info("proposal-generator", "engine proposal skipped", { patientId, bucket, failMode: msg })
        } else {
          logger.error("proposal-generator", "unexpected engine proposal error",
            { patientId, bucket, failMode: "unexpected" }, err as Error)
        }
        return false
      }
    }

    for (const { slot, meals } of bySlot.values()) {
      if (meals.length < MIN_MEALS_PER_SLOT) continue
      slotsConsidered++

      const avgPostGl = mean(meals.map((m) => m.postMgdl! / 100))
      const nadirsGl = meals
        .map((m) => m.nadirMgdl)
        .filter((n): n is number => n !== null)
        .map((n) => n / 100)
      const recurrentHypo = recurrentPostMealHypo(nadirsGl)

      // Haute variabilité → FLAG d'orientation, pas de dose (intercepté AVANT tout builder).
      if (avgPostGl > ceilingGl && recurrentHypo) {
        await clinicalReviewFlagService.raise(patientId, "highVariabilityPostMeal", auditUserId, ctx)
          .then(() => { flagged++ })
          .catch((err) => logger.error("proposal-generator", "raise flag failed",
            { patientId, bucket: `${slot.startHour}-${slot.endHour}` }, err as Error))
        continue
      }

      // Sinon : deadband (baisse si > plafond ; hausse si < borne basse) OU, dans la bande, dé-escalade
      // sur hypos récurrentes (hausse ICR fixe = moins d'insuline).
      let candidate: ProposalCandidate | null = null
      if (avgPostGl > ceilingGl) candidate = analyzeIcrSlot(slot, buildIcrMeals(meals, ceilingGl))
      else if (avgPostGl < lowerGl) candidate = analyzeIcrSlot(slot, buildIcrMeals(meals, lowerGl))
      else if (recurrentHypo) candidate = analyzeIcrHypoDeescalation(slot, nadirsGl)

      if (candidate && (await persist(candidate, slot))) created++
    }

    return { created, flagged, slotsConsidered, mealsUsable: usable.length, skipped: null }
  },

  /**
   * Run PORTEFEUILLE (cron nocturne) : génère les propositions ICR pour tous les patients actifs.
   * Sous **verrou advisory session** (`withSessionAdvisoryLock`) : anti double-run (OVH + Vercel).
   * **Isolation per-patient** : une erreur infra sur un patient (`errored++`) n'arrête pas le portefeuille.
   * Idempotent (anti-spam `one_pending_per_slot`) → sûr même en cas de course. Lectures attribuées à
   * l'acteur système (`CRON_AUDIT_USER_ID = null`).
   * @param ctx Contexte requête (audit).
   * @returns Métriques agrégées ; `skippedConcurrent` si un autre run détient le verrou.
   */
  async generateForAllPatients(ctx?: AuditContext): Promise<GenerateAllResult> {
    const t0 = Date.now()
    const run = await withSessionAdvisoryLock(CRON_LOCK_KEY, async () => {
      const patients = await prisma.patient.findMany({
        where: { deletedAt: null, user: { status: "active" } }, // RGPD : ni supprimés ni comptes inactifs
        select: { id: true },
      })
      let processed = 0
      let created = 0
      let flagged = 0
      let errored = 0
      for (const { id } of patients) {
        try {
          const r = await proposalGeneratorService.generateForPatient(id, CRON_AUDIT_USER_ID, ctx)
          created += r.created
          flagged += r.flagged
        } catch (err) {
          // Isolation : erreur infra (DB/lecture) sur un patient → on compte et on continue.
          errored++
          logger.error("proposal-generator", "generateForPatient failed",
            { patientId: id, failMode: "unexpected" }, err as Error)
        }
        processed++
      }
      return { processed, created, flagged, errored, skippedConcurrent: false }
    })
    const durationMs = Date.now() - t0

    // Marqueur d'audit RUN-LEVEL immuable (piste HDS 5 ans, pas un simple log applicatif) — aligné sur
    // les crons invoice/appointment. Ancre le `requestId` partagé des lectures per-patient (acteur null).
    // Best-effort : un échec d'audit ne doit pas faire échouer le run.
    if (run === null) {
      // Verrou non acquis → un autre run est en cours : skip tracé (cron retry-safe).
      await auditService.log({
        userId: CRON_AUDIT_USER_ID, action: "CREATE", resource: "ADJUSTMENT_PROPOSAL", resourceId: "cron",
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { kind: "proposal.generator.cron.skipped_locked", durationMs },
      }).catch((err) => logger.error("proposal-generator", "cron audit (skipped) failed", { kind: "audit.write.failed" }, err))
      return { processed: 0, created: 0, flagged: 0, errored: 0, skippedConcurrent: true }
    }

    await auditService.log({
      userId: CRON_AUDIT_USER_ID, action: "CREATE", resource: "ADJUSTMENT_PROPOSAL", resourceId: "cron",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: {
        kind: "proposal.generator.cron.run",
        processed: run.processed, created: run.created, flagged: run.flagged, errored: run.errored, durationMs,
      },
    }).catch((err) => logger.error("proposal-generator", "cron audit (run) failed", { kind: "audit.write.failed" }, err))
    return run
  },
}
