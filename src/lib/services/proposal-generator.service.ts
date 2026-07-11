/**
 * Générateur de propositions d'ajustement (US-2651).
 *
 * Orchestre l'assemblage des données → les analyseurs purs (`proposal-algorithm`) → la persistance
 * moteur (`adjustmentService.createEngineProposal`). **Aucune** proposition n'est appliquée : tout
 * reste `pending`, gaté médecin (ADR #13).
 *
 * Spec de référence (deadband post-prandial, grossesse, nadir, bucketing, portes qualité) :
 * `docs/clinical-logic/algorithme-propositions-ajustement.md` §5ter.
 *
 * Périmètre (épic US-2645 — COMPLET, tous modes) : `basalBolus` → **ICR** + **basal** (`basalRate`,
 * POMPE, créneau nocturne titré à jeun) + **ISF** (corrections propres appariées) ; `fixedDose` →
 * **doses simples** par moment (titrées sur les creux pré-dose) ; `nonInsulin` (mode c) → uniquement des
 * `ClinicalReviewFlag` d'orientation (dont `observance`, `tirBelowTarget`, `hba1c*`). Chaque levier porte
 * la **dé-escalade active** des hypos récurrentes (US-2653 : matrice deadband × nadir, cooldown 72 h,
 * Somogyi → flag). La frontière MDR (`nonInsulin` → aucune dose) est re-imposée par `createEngineProposal`.
 *
 * ⚠️ Le chemin basal est **couplé à l'existence des carb-ratios** : `generateForPatient` renvoie tôt
 * (`EMPTY("noCarbRatios")`) si aucun ICR n'est configuré, donc un patient pompe avec basale mais **sans**
 * carb-ratios n'obtient pas (encore) de proposition basale. Acceptable pour un `basalBolus` bien formé
 * (le bolus repas implique des carb-ratios) ; découplage tracé en suivi.
 */
import type { AdjustableParameter, Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { logger } from "@/lib/logger"
import { withSessionAdvisoryLock } from "@/lib/db/cron-lock"
import {
  CLINICAL_BOUNDS, HBA1C_STALE_DAYS, DASHBOARD_TIR, OBSERVANCE,
  HBA1C_HIGH_DEFAULT_PERCENT, HBA1C_HIGH_DEFAULT_PREGNANCY_PERCENT, HBA1C_TARGET_MARGIN_PERCENT,
} from "@/lib/clinical-bounds"
import { cgmCaptureRate } from "@/lib/statistics"
import { findSlotForHour } from "@/lib/insulin-slots"
import {
  analyzeIcrSlot, analyzeIcrHypoDeescalation, recurrentPostMealHypo, hasSevereHypo, analyzeBasalTrend,
  analyzeIsfSlot, analyzeIsfHypoDeescalation, analyzeBasalHypoDeescalation, analyzeFixedDose,
  analyzeFixedDoseHypoDeescalation, type ProposalCandidate,
} from "@/lib/proposal-algorithm"
import { analyticsService } from "@/lib/services/analytics.service"
import { clinicalReviewFlagService } from "@/lib/services/clinical-review-flag.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { mealtimePattern, localDay, type JournalMeal, type CorrectionPoint } from "@/lib/services/meal-trends.service"
import { getCgmDefaults, objectivesService } from "@/lib/services/objectives.service"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { auditService } from "@/lib/services/audit.service"
import type { AuditContext } from "@/lib/services/patient.service"

/** Fenêtre d'analyse (14 j — standard AGP, aligné `AGP_SUFFICIENCY.MIN_DAYS`). */
const ANALYSIS_PERIOD = "14d"
/** US-2651 ISF — période plus longue (30 j) : les corrections propres sont rares (validé medical #683).
 *  US-2658 — fixe MÊME quand une fenêtre à la demande est choisie (l'ISF ne suit pas `windowDays`, §3). */
export const ISF_ANALYSIS_WINDOW_DAYS = 30
const ISF_ANALYSIS_PERIOD = `${ISF_ANALYSIS_WINDOW_DAYS}d`
/** Minimum de repas appariés par créneau (aligné `analyzeIcrSlot` + `BGM_CARNET.MIN_READINGS_PER_MOMENT`). */
const MIN_MEALS_PER_SLOT = 3
/** US-2651 basal — nb minimal de nuits avec un nadir nocturne CGM pour autoriser une HAUSSE basale
 *  (coverage guard Somogyi ; sans couverture, une hypo 3 h masquée passerait). Découplé de
 *  `MIN_MEALS_PER_SLOT` (sémantiques distinctes) même si la valeur coïncide. */
const MIN_NADIR_NIGHTS = 3

/** Résultat d'un run patient — métriques d'observabilité (aucune valeur clinique). */
export interface GenerateResult {
  created: number
  /** US-2653 — flags de revue CONTEXTUELS levés : haute-variabilité (ICR/ISF/fixedDose), Somogyi basal, hypo
   *  sévère isolée (ISF/basal/fixedDose — **PAS l'ICR** : le levier ICR ne surface pas un sévère isolé
   *  post-repas, cf. matrice) et dé-escalade non actionnable (basal/fixedDose). Orientation, JAMAIS une dose. */
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

/**
 * US-2653 — **cooldown anti-cliquet du moteur**. `true` si une **dé-escalade** (baisse à magnitude FIXE)
 * sur ce `(patient × paramètre × créneau)` doit être **sautée** parce que le dernier changement a été
 * **accepté** il y a moins de `ENGINE_DEESCALATION_COOLDOWN_HOURS` — l'effet d'un ajustement se juge sur
 * ≥ 3 j ; sans ce garde, une magnitude fixe non auto-limitante empilerait des baisses avant tout effet
 * observable (sur-correction → hyper / cétose). Ne concerne QUE la dé-escalade fixe : l'escalade
 * proportionnelle du deadband est auto-limitante. Skip **silencieux** (on a déjà agi, on attend l'effet).
 *
 * @param slotWhere Discriminateur de créneau du paramètre (ICR: `carbRatioSlot*` ; ISF: `timeSlot*` ;
 *   basal: `pumpBasalSlotId` ; fixedDose: `moment`).
 */
async function lastAcceptedChangeAt(
  patientId: number,
  parameterType: AdjustableParameter,
  slotWhere: Prisma.AdjustmentProposalWhereInput,
): Promise<Date | null> {
  const last = await prisma.adjustmentProposal.findFirst({
    // `reviewedAt: { not: null }` — sous PG `ORDER BY ... DESC` place les NULL en premier ; sans ce filtre
    // une ligne `accepted` à `reviewedAt` NULL (ne devrait pas exister — l'acceptation le pose) masquerait
    // une acceptation récente. Ceinture-et-bretelles.
    where: { patientId, parameterType, status: "accepted", reviewedAt: { not: null }, ...slotWhere },
    orderBy: { reviewedAt: "desc" },
    select: { reviewedAt: true },
  })
  return last?.reviewedAt ?? null
}

/**
 * US-2653 (fix Q6a) — **temporalité anti-cliquet** d'une dé-escalade sur un `(patient × paramètre × créneau)`.
 * Le cooldown est un **plancher temporel**, pas la vraie porte : la porte est le **compte d'observations
 * POST-changement** (appliquée côté appelant en filtrant les nadirs à `dayIso > cutoff` avant l'analyseur).
 *  - `cutoff` : jour local du dernier changement ACCEPTÉ (`null` si aucun → première dé-escalade, fenêtre entière) ;
 *  - `withinCooldown` : `true` si ce changement date de < `ENGINE_DEESCALATION_COOLDOWN_HOURS` (délai non écoulé).
 * Une dé-escalade ne se persiste que si `!withinCooldown` **ET** le signal récurrent tient sur le POST-changement.
 */
async function deescalationTiming(
  patientId: number,
  parameterType: AdjustableParameter,
  slotWhere: Prisma.AdjustmentProposalWhereInput,
): Promise<{ cutoff: string | null; withinCooldown: boolean }> {
  const at = await lastAcceptedChangeAt(patientId, parameterType, slotWhere)
  if (at === null) return { cutoff: null, withinCooldown: false }
  return {
    cutoff: localDay(at.getTime()),
    withinCooldown: Date.now() - at.getTime() < CLINICAL_BOUNDS.ENGINE_DEESCALATION_COOLDOWN_HOURS * 3_600_000,
  }
}

/** US-2653 (fix Q6a) — observations datées APRÈS le dernier changement accepté (par jour local). `cutoff`
 *  `null` → toutes (aucun changement antérieur). */
function afterCutoff<T extends { dayIso: string }>(obs: T[], cutoff: string | null): T[] {
  return cutoff === null ? obs : obs.filter((o) => o.dayIso > cutoff)
}

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
 * Cible à jeun (g/L) pour la titration basale (US-2651, validé medical) : cible individualisée
 * (`glucoseTargets`) si **plausible** (dans `[FASTING_TARGET_MIN_GL ; max]`, `max` resserré en grossesse),
 * sinon **défaut** adulte/grossesse. Une cible hors bande (import corrompu) → défaut (fail-loud).
 * **JAMAIS `titrLow`** (plancher hypo → titrerait la basale vers l'hypo).
 */
function resolveFastingTarget(individualizedGl: number | null, isPregnancy: boolean): number {
  const max = isPregnancy ? CLINICAL_BOUNDS.FASTING_TARGET_MAX_PREGNANCY_GL : CLINICAL_BOUNDS.FASTING_TARGET_MAX_GL
  if (individualizedGl !== null && individualizedGl >= CLINICAL_BOUNDS.FASTING_TARGET_MIN_GL && individualizedGl <= max) {
    return individualizedGl
  }
  return isPregnancy ? CLINICAL_BOUNDS.FASTING_TARGET_PREGNANCY_GL : CLINICAL_BOUNDS.FASTING_TARGET_DEFAULT_GL
}

/**
 * Codes de rejet ATTENDUS de `createEngineProposal` (fail-closed, non fatals). Tout autre message
 * est traité comme inattendu : on ne le logue PAS verbatim (défense en profondeur PHI, suivi HDS) —
 * code générique `"unexpected"` + erreur brute vers `logger.error`.
 */
const EXPECTED_SKIP = new Set([
  "baselineMovedAtPersist", "duplicatePendingProposal", "valueOutOfBounds",
  "reasonDirectionMismatch", "nonInsulinNoDose", "invalidSupportingEvents",
  "slotRequired", "currentValueNotFound",
])

export const proposalGeneratorService = {
  /**
   * Génère les propositions moteur d'un patient (mode-aware : ICR + basal + ISF en `basalBolus` ;
   * doses simples en `fixedDose` ; flags d'orientation en `nonInsulin`). Ne persiste que des `pending`.
   * @param patientId Patient cible.
   * @param auditUserId Acteur d'audit (le cron passe un ID système `null`).
   * @param ctx Contexte requête (audit).
   * @param windowDays US-2658 — fenêtre d'analyse à la demande, bornée [2,14] par l'appelant. Applique
   *   `${windowDays}d` aux chemins ICR / basal / dose fixe (repas, à-jeun, creux pré-dose). **L'ISF garde
   *   délibérément sa fenêtre 30 j** (corrections propres rares — décision US-2658 §3). Absente (cron) →
   *   `ANALYSIS_PERIOD` (14 j), comportement inchangé.
   * @returns Métriques du run (sans PHI).
   */
  async generateForPatient(
    patientId: number,
    auditUserId: number | null,
    ctx?: AuditContext,
    windowDays?: number,
  ): Promise<GenerateResult> {
    // 0. Mode — routage : `nonInsulin` → flags d'orientation (mode c, jamais de dose, frontière MDR) ;
    //    `fixedDose` → titration des doses simples par moment ; `basalBolus` → ICR + basal + ISF (ci-dessous).
    const { mode } = await treatmentModeService.resolveTreatmentMode(patientId)
    if (mode === "nonInsulin") return proposalGeneratorService.generateOrientationFlags(patientId, auditUserId, ctx)
    if (mode === "fixedDose") return proposalGeneratorService.generateFixedDoseProposals(patientId, auditUserId, ctx, windowDays)
    if (mode !== "basalBolus") return EMPTY("mode")

    // Fenêtre d'analyse (ICR/basal/dose fixe) : à la demande si fournie, sinon période cron par défaut.
    const analysisPeriod = windowDays != null ? `${windowDays}d` : ANALYSIS_PERIOD

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
    const journal = await mealtimePattern.dailyJournal(patientId, analysisPeriod, auditUserId, ctx, { source: "cgm" })
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
          analysisPeriod,
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
      const icrBucket = `${slot.startHour}-${slot.endHour}`
      const raiseIcrFlag = () =>
        clinicalReviewFlagService.raise(patientId, "highVariabilityPostMeal", auditUserId, ctx)
          .then(() => { flagged++ })
          .catch((err) => logger.error("proposal-generator", "raise flag failed", { patientId, bucket: icrBucket }, err as Error))

      // Haute variabilité → FLAG d'orientation, pas de dose (intercepté AVANT tout builder).
      if (avgPostGl > ceilingGl && recurrentHypo) {
        await raiseIcrFlag()
        continue
      }

      // US-2653 (fix Q6a) — la dé-escalade se juge sur les nadirs DATÉS APRÈS le dernier changement accepté
      // (jamais re-titrer sur des hypos périmées) ; `withinCooldown` = plancher temporel séparé.
      const { cutoff, withinCooldown } = await deescalationTiming(patientId, "insulinToCarbRatio", { carbRatioSlotStart: slot.startHour, carbRatioSlotEnd: slot.endHour })
      const postNadirsGl = afterCutoff(meals, cutoff).map((m) => m.nadirMgdl).filter((n): n is number => n !== null).map((n) => n / 100)

      // Sinon : deadband (baisse si > plafond ; hausse si < borne basse) OU, dans la bande, dé-escalade
      // sur hypos récurrentes POST-changement (hausse ICR fixe = moins d'insuline).
      let candidate: ProposalCandidate | null = null
      let isDeescalation = false
      if (avgPostGl > ceilingGl) {
        candidate = analyzeIcrSlot(slot, buildIcrMeals(meals, ceilingGl)) // baisse (deadband, non gaté)
      } else if (avgPostGl < lowerGl) {
        candidate = analyzeIcrSlot(slot, buildIcrMeals(meals, lowerGl)) // hausse (deadband)
        // Fallback (validé medical) : moyenne juste sous la borne (deadband < 2 % → null) MAIS hypos
        // récurrentes POST-changement → dé-escalade fixe +10 % (même sens sûr, plus protecteur).
        if (!candidate && recurrentHypo) { candidate = analyzeIcrHypoDeescalation(slot, postNadirsGl); isDeescalation = true }
      } else if (recurrentHypo) {
        candidate = analyzeIcrHypoDeescalation(slot, postNadirsGl) // in-band + récurrent POST-changement → +10 %
        isDeescalation = true
      }

      // Dé-escalade bloquée (délai non écoulé OU signal insuffisant sur le POST-changement) → ne pas
      // re-titrer ; mais ne JAMAIS taire un nadir SÉVÈRE → flag de revue (US-2653 fix Q6b).
      if (isDeescalation && (withinCooldown || candidate === null)) {
        candidate = null
        if (hasSevereHypo(nadirsGl)) await raiseIcrFlag()
      }

      if (candidate && (await persist(candidate, slot))) created++
    }

    // 6. Chemin BASAL (US-2651, validé medical) — POMPE uniquement. Titre le créneau NOCTURNE actif à
    // ~05:00 (action insuline ~05:00 → effet 06:00-08:00 = fasting) par la glycémie à jeun. Stylo/MDI
    // (single/split_injection) = dose fixe (autre chemin). Créneaux de jour différés (limite connue).
    const basalConfig = settings?.basalConfiguration
    if (basalConfig?.configType === "pump" && basalConfig.pumpSlots.length > 0) {
      const pumpSlots = basalConfig.pumpSlots.map((s) => ({
        id: s.id,
        rate: Number(s.rate),
        startHour: s.startTime.getUTCHours(),
        endHour: s.endTime.getUTCHours(),
      }))
      const nocturnalSlot = findSlotForHour(pumpSlots, CLINICAL_BOUNDS.NOCTURNAL_TITRATION_REF_HOUR)
      if (nocturnalSlot) {
        // Cible à jeun (JAMAIS titrLow) : individualisée si plausible, sinon défaut adulte/grossesse.
        // `[0]` = 1re cible active (pas encore fasting-scoped) ; sûr car `resolveFastingTarget` clampe à
        // `[0,80 ; 1,30]` (jamais vers l'hypo). À préférer un champ fasting dédié si disponible plus tard.
        const rawTarget = settings?.glucoseTargets?.[0]?.targetGlucose
        const targetGl = resolveFastingTarget(rawTarget != null ? Number(rawTarget) / 100 : null, isPregnancy)
        // À jeun (pré-petit-déj) + nadirs nocturnes par nuit. mg/dL → g/L, null filtrés.
        const fasting = await mealtimePattern.fastingTrend(patientId, analysisPeriod, auditUserId, ctx, { source: "cgm" })
        const fastingValues = fasting
          .map((f) => f.fastingMgdl)
          .filter((v): v is number => v !== null && Number.isFinite(v))
          .map((v) => v / 100)
        const nocturnalNadirs = fasting
          .map((f) => f.nocturnalNadirMgdl)
          .filter((v): v is number => v !== null && Number.isFinite(v))
          .map((v) => v / 100)
        const avgFasting = fastingValues.length > 0 ? mean(fastingValues) : 0
        const recurrentNoct = recurrentPostMealHypo(nocturnalNadirs)
        const severeNoct = hasSevereHypo(nocturnalNadirs)
        // US-2653 (fix Q6a) — nadirs nocturnes POST-changement (datés après le dernier ajustement accepté).
        const { cutoff: basalCutoff, withinCooldown } = await deescalationTiming(patientId, "basalRate", { pumpBasalSlotId: nocturnalSlot.id })
        const postNocturnalNadirs = afterCutoff(fasting, basalCutoff)
          .map((f) => f.nocturnalNadirMgdl)
          .filter((v): v is number => v !== null && Number.isFinite(v))
          .map((v) => v / 100)
        const basalBucket = `basal:${nocturnalSlot.startHour}-${nocturnalSlot.endHour}`

        // Flag nocturne CONTEXTUEL (Somogyi / non-actionnable / sévère isolé) — orientation, jamais une dose.
        const raiseNocturnalFlag = () =>
          clinicalReviewFlagService.raise(patientId, "nocturnalHypoHighFasting", auditUserId, ctx)
            .then(() => { flagged++ })
            .catch((err) => logger.error("proposal-generator", "raise flag failed", { patientId, bucket: basalBucket }, err as Error))

        const persistBasal = async (cand: ProposalCandidate) => {
          try {
            await adjustmentService.createEngineProposal({
              patientId,
              parameterType: "basalRate",
              proposedValue: cand.proposedValue,
              expectedCurrentValue: cand.currentValue,
              reason: cand.reason,
              confidence: cand.confidence,
              supportingEvents: cand.supportingEvents,
              totalEventsConsidered: cand.totalEventsConsidered,
              averageObservedValue: cand.averageObservedValue ?? null,
              analysisPeriod,
              pumpBasalSlotId: nocturnalSlot.id,
            }, ctx)
            created++
          } catch (err) {
            const msg = (err as Error).message
            if (EXPECTED_SKIP.has(msg)) {
              logger.info("proposal-generator", "engine proposal skipped", { patientId, bucket: basalBucket, failMode: msg })
            } else {
              logger.error("proposal-generator", "unexpected engine proposal error",
                { patientId, bucket: basalBucket, failMode: "unexpected" }, err as Error)
            }
          }
        }

        // MATRICE deadband × nadir nocturne (US-2653, validé medical) :
        //  - à jeun HAUT + hypo nocturne RÉCURRENTE = Somogyi vs phénomène de l'aube (direction non fiable
        //    à automatiser) → FLAG de revue, JAMAIS une baisse directe (medical : rejet du Somogyi auto).
        if (avgFasting > targetGl && recurrentNoct) {
          await raiseNocturnalFlag()
        } else {
          const candidate = analyzeBasalTrend(fastingValues, targetGl, nocturnalSlot.rate, nocturnalNadirs)
          // Coverage guard Somogyi : n'autoriser une HAUSSE que si ≥ MIN_NADIR_NIGHTS nuits de nadir CGM
          // (sinon repli fastingValues → hypo 3 h masquée → hausse dangereuse). Baisses inconditionnelles.
          const isIncrease = candidate?.reason === "basalTooLow"
          if (candidate && !(isIncrease && nocturnalNadirs.length < MIN_NADIR_NIGHTS)) {
            await persistBasal(candidate) // deadband (proportionnel, auto-limité → pas de cooldown)
          } else if (recurrentNoct) {
            // Dans la bande + hypo nocturne récurrente → baisse FIXE −10 % (dé-escalade). Jugée sur les
            // nadirs POST-changement (Q6a) + plancher temporel `withinCooldown`.
            const de = analyzeBasalHypoDeescalation(nocturnalSlot.rate, postNocturnalNadirs)
            if (de.kind === "proposal" && !withinCooldown) {
              await persistBasal(de.candidate)
            } else if (de.kind === "flagNonActionable") {
              await raiseNocturnalFlag() // débit trop bas pour titrer d'un incrément → restructuration = revue
            } else if (severeNoct) {
              await raiseNocturnalFlag() // dé-escalade bloquée (délai/post-changement) mais nadir SÉVÈRE → jamais tu (Q6b)
            }
          } else if (severeNoct) {
            await raiseNocturnalFlag() // hypo sévère nocturne ISOLÉE → surface, jamais silencieuse
          }
        }
      }
    }

    // 7. Chemin ISF (US-2651) — titre chaque créneau ISF par les CORRECTIONS propres appariées.
    // Pas de coverage guard dédié (≠ basal) : `correctionTrend` est CGM-only + fail-closed, donc chaque
    // point a un nadir → la garde hypo d'`analyzeIsfSlot` (baisse ISF = plus d'insuline) suffit (medical #683).
    // Bord : sous une rareté CGM extrême (trou de ~5 h), `nadirGl` peut être null → la garde se replie
    // sur `postGlucoseGl` (valeur settled à 5 h). Cas rare (haut à 5 h + hypo nadir = rebond), borné ±20 %.
    const isfSlots = settings?.sensitivityFactors ?? []
    if (isfSlots.length > 0) {
      const corrections = await mealtimePattern.correctionTrend(patientId, ISF_ANALYSIS_PERIOD, auditUserId, ctx)
      const isfSlotShapes = isfSlots.map((s) => ({
        startHour: s.startHour, endHour: s.endHour, sensitivityFactorGl: Number(s.sensitivityFactorGl),
      }))
      // Grouper les corrections par créneau ISF APPLIQUÉ (heure de la correction).
      const byIsfSlot = new Map<number, { slot: (typeof isfSlotShapes)[number]; points: CorrectionPoint[] }>()
      for (const pt of corrections) {
        const slot = findSlotForHour(isfSlotShapes, pt.localHour)
        if (!slot) continue
        const entry = byIsfSlot.get(slot.startHour) ?? { slot, points: [] }
        entry.points.push(pt)
        byIsfSlot.set(slot.startHour, entry)
      }
      for (const { slot, points } of byIsfSlot.values()) {
        const isfBucket = `isf:${slot.startHour}-${slot.endHour}`
        // Nadirs de corrections PROPRES ISOLÉES uniquement (COB/IOB exclus par `correctionTrend`) — jamais
        // un nadir post-repas (invariant provenance US-2653). `nadirGl` null (rareté CGM) → ne compte pas.
        const nadirsGl = points.map((p) => p.nadirGl).filter((n): n is number => n != null)
        const recurrent = recurrentPostMealHypo(nadirsGl)
        const severe = hasSevereHypo(nadirsGl)
        const avgPost = mean(points.map((p) => p.postGlucoseGl))
        const avgTarget = mean(points.map((p) => p.targetGl))
        // US-2653 (fix Q6a) — nadirs post-correction DATÉS APRÈS le dernier changement accepté.
        const { cutoff: isfCutoff, withinCooldown: isfWithinCooldown } = await deescalationTiming(patientId, "insulinSensitivityFactor", { timeSlotStartHour: slot.startHour, timeSlotEndHour: slot.endHour })
        const postNadirsGl = afterCutoff(points, isfCutoff).map((p) => p.nadirGl).filter((n): n is number => n != null)

        const raiseIsfFlag = () =>
          clinicalReviewFlagService.raise(patientId, "highVariabilityPostCorrection", auditUserId, ctx)
            .then(() => { flagged++ })
            .catch((err) => logger.error("proposal-generator", "raise flag failed", { patientId, bucket: isfBucket }, err as Error))

        const persistIsf = async (cand: ProposalCandidate) => {
          try {
            await adjustmentService.createEngineProposal({
              patientId,
              parameterType: "insulinSensitivityFactor",
              proposedValue: cand.proposedValue,
              expectedCurrentValue: cand.currentValue,
              reason: cand.reason,
              confidence: cand.confidence,
              supportingEvents: cand.supportingEvents,
              totalEventsConsidered: cand.totalEventsConsidered,
              averageObservedValue: cand.averageObservedValue ?? null,
              analysisPeriod: ISF_ANALYSIS_PERIOD,
              timeSlotStartHour: slot.startHour,
              timeSlotEndHour: slot.endHour,
            }, ctx)
            created++
          } catch (err) {
            const msg = (err as Error).message
            if (EXPECTED_SKIP.has(msg)) {
              logger.info("proposal-generator", "engine proposal skipped", { patientId, bucket: isfBucket, failMode: msg })
            } else {
              logger.error("proposal-generator", "unexpected engine proposal error",
                { patientId, bucket: isfBucket, failMode: "unexpected" }, err as Error)
            }
          }
        }

        // MATRICE deadband × nadir post-correction (US-2653, validé medical) :
        //  - sous-correction MOYENNE (post-correction > cible) + hypos post-correction RÉCURRENTES = conflit
        //    (un ISF unique ne corrige pas sous-correction + sur-correction intermittente = timing/IOB/stacking)
        //    → FLAG, jamais une dose.
        if (avgTarget > 0 && avgPost > avgTarget && recurrent) {
          await raiseIsfFlag()
        } else {
          const candidate = analyzeIsfSlot(
            slot,
            points.map((p) => ({ postGlucoseGl: p.postGlucoseGl, targetGl: p.targetGl, nadirGl: p.nadirGl ?? undefined })),
          )
          if (candidate) {
            await persistIsf(candidate) // deadband (proportionnel, auto-limité → pas de cooldown)
          } else if (recurrent) {
            // Dans la bande + hypos post-correction récurrentes → hausse ISF FIXE +10 % (dé-escalade). Jugée
            // sur les nadirs POST-changement (Q6a) + plancher temporel.
            const de = analyzeIsfHypoDeescalation(slot, postNadirsGl)
            if (de && !isfWithinCooldown) {
              await persistIsf(de)
            } else if (severe) {
              await raiseIsfFlag() // dé-escalade bloquée (délai/post-changement) mais nadir SÉVÈRE → jamais tu (Q6b)
            }
          } else if (severe) {
            await raiseIsfFlag() // hypo sévère post-correction ISOLÉE → surface, jamais silencieuse
          }
        }
      }
    }

    return { created, flagged, slotsConsidered, mealsUsable: usable.length, skipped: null }
  },

  /**
   * Mode `fixedDose` (« doses simples ») — titre chaque DOSE FIXE par moment (US-2652). Les creux
   * pré-dose viennent de `fixedDoseTrend` (shift Option B, BGM). Cible = `resolveFastingTarget`
   * (pré-prandiale 1,00/0,90, JAMAIS `titrLow`). `analyzeFixedDose` : plancher ≥ 3 relevés, snap 0,5 U,
   * cap ±10 %/±2 U, **garde hypo** (bloque une hausse sur un creux hypo). Persistance par `moment`
   * (discriminateur #685). Les `FixedDoseSlot` vivent sur `PatientInsulin` (pas `InsulinTherapySettings`).
   *
   * @param patientId Patient en mode doses simples.
   * @param auditUserId Acteur d'audit (système `null` pour le cron).
   * @param ctx Contexte requête (audit).
   * @param windowDays US-2658 — fenêtre d'analyse des creux pré-dose à la demande (bornée [2,14] par
   *   l'appelant). Absente (cron) → `ANALYSIS_PERIOD` (14 j).
   * @returns Métriques ; `slotsConsidered` = nb de doses fixes, `created` = propositions générées.
   */
  async generateFixedDoseProposals(
    patientId: number,
    auditUserId: number | null,
    ctx?: AuditContext,
    windowDays?: number,
  ): Promise<GenerateResult> {
    // Fenêtre d'analyse des creux pré-dose : à la demande si fournie (US-2658), sinon 14 j (cron).
    const analysisPeriod = windowDays != null ? `${windowDays}d` : ANALYSIS_PERIOD
    const fixedSlots = await prisma.fixedDoseSlot.findMany({
      where: { patientInsulin: { patientId } },
      select: { moment: true, valueU: true },
    })
    if (fixedSlots.length === 0) return EMPTY("noFixedDose")

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { pathology: true, pregnancyMode: true },
    })
    // Fail-closed RGPD (ADR #4, symétrie avec le chemin basalBolus) : un patient soft-deleted ne reçoit
    // aucune proposition moteur (le cron pré-filtre déjà `deletedAt`, mais protège l'appel direct).
    if (!patient) return EMPTY("noPatient")
    const isPregnancy = patient.pregnancyMode === true || patient.pathology === "GD"
    // Cible pré-prandiale individualisée si plausible, sinon défaut (JAMAIS titrLow). Scopée patient.
    const targetRow = await prisma.glucoseTarget.findFirst({
      where: { settings: { patientId }, isActive: true },
      select: { targetGlucose: true },
    })
    const targetGl = resolveFastingTarget(targetRow ? Number(targetRow.targetGlucose) / 100 : null, isPregnancy)

    // Creux pré-dose par moment (shift Option B, BGM). Fenêtre = `analysisPeriod` (à la demande si
    // fournie, sinon 14 j — réactif, comme le basal).
    const troughs = await analyticsService.fixedDoseTrend(patientId, analysisPeriod, auditUserId, ctx)

    let created = 0
    let flagged = 0
    for (const slot of fixedSlots) {
      const bucket = `fixedDose:${slot.moment}`
      const valueU = Number(slot.valueU)
      const troughRows = troughs[slot.moment] ?? []
      const glValues = troughRows.map((r) => r.gl)
      const readings = glValues.map((g) => ({ postGlucoseGl: g, targetGl }))
      const recurrent = recurrentPostMealHypo(glValues)
      const severe = hasSevereHypo(glValues)
      const avgReading = glValues.length > 0 ? mean(glValues) : 0
      // US-2653 (fix Q6a) — relevés du moment DATÉS APRÈS le dernier changement accepté.
      const { cutoff: fdCutoff, withinCooldown: fdWithinCooldown } = await deescalationTiming(patientId, "fixedDose", { moment: slot.moment })
      const postGlValues = afterCutoff(troughRows, fdCutoff).map((r) => r.gl)

      const raiseFixedFlag = () =>
        clinicalReviewFlagService.raise(patientId, "highVariabilityFixedDose", auditUserId, ctx)
          .then(() => { flagged++ })
          .catch((err) => logger.error("proposal-generator", "raise flag failed", { patientId, bucket }, err as Error))

      const persistFixed = async (cand: ProposalCandidate) => {
        try {
          await adjustmentService.createEngineProposal({
            patientId,
            parameterType: "fixedDose",
            moment: slot.moment,
            proposedValue: cand.proposedValue,
            expectedCurrentValue: cand.currentValue,
            reason: cand.reason,
            confidence: cand.confidence,
            supportingEvents: cand.supportingEvents,
            totalEventsConsidered: cand.totalEventsConsidered,
            averageObservedValue: cand.averageObservedValue ?? null,
            analysisPeriod,
          }, ctx)
          created++
        } catch (err) {
          const msg = (err as Error).message
          if (EXPECTED_SKIP.has(msg)) {
            logger.info("proposal-generator", "engine proposal skipped", { patientId, bucket, failMode: msg })
          } else {
            logger.error("proposal-generator", "unexpected engine proposal error",
              { patientId, bucket, failMode: "unexpected" }, err as Error)
          }
        }
      }

      // MATRICE deadband × relevés du moment (US-2653, validé medical) :
      //  - moyenne du moment > cible + hypos récurrentes = conflit (la dose ne corrige pas moyenne haute +
      //    creux) → FLAG, jamais une dose.
      if (avgReading > targetGl && recurrent) {
        await raiseFixedFlag()
      } else {
        const candidate = analyzeFixedDose({ moment: slot.moment, valueU }, readings)
        if (candidate) {
          await persistFixed(candidate) // deadband (proportionnel, auto-limité → pas de cooldown)
        } else if (recurrent) {
          // Dans la bande + relevés récurremment bas → baisse FIXE bornée (dé-escalade). Jugée sur les
          // relevés POST-changement (Q6a) + plancher temporel `fdWithinCooldown`.
          const de = analyzeFixedDoseHypoDeescalation({ moment: slot.moment, valueU }, postGlValues)
          const recurrentPost = recurrentPostMealHypo(postGlValues)
          if (de.kind === "proposal" && !fdWithinCooldown) {
            await persistFixed(de.candidate)
          } else if (de.kind === "flagNonActionable" || (recurrentPost && valueU < CLINICAL_BOUNDS.FIXED_DOSE_MIN)) {
            // Non réductible POST-changement (dose au/sous plancher clinique 0,5 U) → FLAG de revue
            // (arrêt/restructuration), jamais un silence sur une hypo récurrente avérée.
            await raiseFixedFlag()
          } else if (severe) {
            await raiseFixedFlag() // dé-escalade bloquée (délai/post-changement) mais relevé SÉVÈRE → jamais tu (Q6b)
          }
        } else if (severe) {
          await raiseFixedFlag() // hypo sévère du moment ISOLÉE → surface, jamais silencieuse
        }
      }
    }
    return { created, flagged, slotsConsidered: fixedSlots.length, mealsUsable: 0, skipped: null }
  },

  /**
   * Mode (c) — patient NON insuliné : **aucune proposition de dose** (frontière MDR / IEC 62304),
   * uniquement des `ClinicalReviewFlag` d'**orientation** (« à revoir en consultation »).
   *
   * 4 flags (tous idempotents — `raise` dédoublonne un flag ouvert du même type) :
   * - `hba1cStale` : dernière HbA1c (labo) > `HBA1C_STALE_DAYS` (180 j) ou absente.
   * - `hba1cAboveTarget` : HbA1c RÉCENTE au-dessus de la cible (comble le trou BGM-only).
   * - `tirBelowTarget` : TIR 14 j < cible (CGM, pathology-aware).
   * - `observance` : **suivi glycémique insuffisant** (either/or CGM-capture / comptage BGM ; garde
   *   enrollment ; jamais l'adhésion médicamenteuse, non mesurable — cf. `OBSERVANCE`, validé medical).
   *
   * @param patientId Patient non insuliné.
   * @param auditUserId Acteur d'audit (système `null` pour le cron).
   * @param ctx Contexte requête (audit).
   * @returns Métriques ; `flagged` = nb de flags levés (jamais de dose).
   */
  async generateOrientationFlags(patientId: number, auditUserId: number | null, ctx?: AuditContext): Promise<GenerateResult> {
    let flagged = 0

    // Audit HDS : accès aux données de santé (HbA1c, TIR) sous l'acteur système. Best-effort.
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT", resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "orientation-flags" },
    }).catch((err) => logger.error("proposal-generator", "orientation-flags audit failed", { patientId }, err as Error))

    // Dernière HbA1c (date + VALEUR de la source la plus récente) + patient + cible individualisée.
    const [gly, evt, patient, annex] = await Promise.all([
      prisma.glycemiaEntry.findFirst({
        where: { patientId, hba1c: { not: null } }, orderBy: { date: "desc" }, select: { date: true, hba1c: true },
      }),
      prisma.diabetesEvent.findFirst({
        where: { patientId, hba1c: { not: null } }, orderBy: { eventDate: "desc" }, select: { eventDate: true, hba1c: true },
      }),
      prisma.patient.findFirst({
        where: { id: patientId, deletedAt: null }, select: { pathology: true, pregnancyMode: true, createdAt: true },
      }),
      prisma.annexObjective.findUnique({ where: { patientId }, select: { objectiveHba1c: true } }),
    ])
    // Valeur = celle de la source à la date MAX (pas la valeur max) ; égalité → GlycemiaEntry (déterministe).
    const glyMs = gly?.date.getTime() ?? null
    const evtMs = evt?.eventDate.getTime() ?? null
    let lastHba1cMs: number | null = null
    let lastHba1cValue: number | null = null
    if (glyMs !== null && (evtMs === null || glyMs >= evtMs)) { lastHba1cMs = glyMs; lastHba1cValue = Number(gly!.hba1c) }
    else if (evtMs !== null) { lastHba1cMs = evtMs; lastHba1cValue = Number(evt!.hba1c) }
    const staleMs = HBA1C_STALE_DAYS * 86_400_000
    const isStale = lastHba1cMs === null || Date.now() - lastHba1cMs > staleMs
    const isPregnancy = patient?.pregnancyMode === true || patient?.pathology === "GD"

    // hba1cStale — dernière HbA1c périmée (> 180 j) OU absente.
    if (isStale) {
      await clinicalReviewFlagService.raise(patientId, "hba1cStale", auditUserId, ctx)
        .then(() => { flagged++ })
        .catch((err) => logger.error("proposal-generator", "raise hba1cStale failed", { patientId }, err as Error))
    }

    // hba1cAboveTarget — HbA1c RÉCENTE (!isStale) au-dessus de la cible. Comble le trou BGM-only ;
    // le périmé est possédé par hba1cStale (pas de double-signal). Cible = objectiveHba1c individualisée
    // (+ marge, si plausible [4;14] — garde fail-loud contre un import corrompu qui masquerait un
    // patient) SINON défaut (grossesse 6,0 / adulte 8,0 ; sans marge). En %.
    if (lastHba1cValue !== null && !isStale) {
      const obj = annex?.objectiveHba1c != null ? Number(annex.objectiveHba1c) : null
      const target = obj !== null && obj >= 4.0 && obj <= 14.0
        ? obj + HBA1C_TARGET_MARGIN_PERCENT
        : (isPregnancy ? HBA1C_HIGH_DEFAULT_PREGNANCY_PERCENT : HBA1C_HIGH_DEFAULT_PERCENT)
      if (lastHba1cValue > target) {
        await clinicalReviewFlagService.raise(patientId, "hba1cAboveTarget", auditUserId, ctx)
          .then(() => { flagged++ })
          .catch((err) => logger.error("proposal-generator", "raise hba1cAboveTarget failed", { patientId }, err as Error))
      }
    }

    // tirBelowTarget — TIR sur 14 j < cible (bornes pathology/GROSSESSE-aware). `null` si capture CGM
    // insuffisante (pas de flag sur un échantillon maigre) — un non-insuliné en BGM pur n'a pas de TIR.
    if (patient) {
      // Un DT2 ENCEINTE doit être scoré contre les bornes GD (0,63–1,40), pas adulte (0,70–1,80).
      const tir = await objectivesService.computeTirPercent(patientId, isPregnancy ? "GD" : patient.pathology)
      if (tir !== null && tir < DASHBOARD_TIR.TARGET_PERCENT) {
        await clinicalReviewFlagService.raise(patientId, "tirBelowTarget", auditUserId, ctx)
          .then(() => { flagged++ })
          .catch((err) => logger.error("proposal-generator", "raise tirBelowTarget failed", { patientId }, err as Error))
      }
    }

    // observance — « suivi glycémique insuffisant » (validé medical). Logique EITHER/OR : ne flague QUE
    // si les DEUX canaux échouent → jamais un porteur CGM régulier (capture ≥ 30 %, capteur abandonné
    // détecté) ni un testeur BGM diligent (≥ seuil pathology-aware). Garde enrollment : pas de flag si
    // le patient est inscrit depuis < une fenêtre (données pas encore observables). Jamais une dose.
    if (patient) {
      const enrolledDays = (Date.now() - patient.createdAt.getTime()) / 86_400_000
      if (enrolledDays >= OBSERVANCE.MIN_ENROLLMENT_DAYS) {
        const since = new Date(Date.now() - OBSERVANCE.WINDOW_DAYS * 86_400_000)
        const [cgmCount, bgmCount] = await Promise.all([
          prisma.cgmEntry.count({ where: { patientId, timestamp: { gte: since } } }),
          prisma.glycemiaEntry.count({ where: { patientId, date: { gte: since } } }),
        ])
        const cgmAdequate = cgmCount > 0 && cgmCaptureRate(cgmCount, OBSERVANCE.WINDOW_DAYS) >= OBSERVANCE.MIN_CGM_CAPTURE_RATE
        const bgmMin = isPregnancy ? OBSERVANCE.BGM_MIN_READINGS_PREGNANCY : OBSERVANCE.BGM_MIN_READINGS_DEFAULT
        if (!cgmAdequate && bgmCount < bgmMin) {
          await clinicalReviewFlagService.raise(patientId, "observance", auditUserId, ctx)
            .then(() => { flagged++ })
            .catch((err) => logger.error("proposal-generator", "raise observance failed", { patientId }, err as Error))
        }
      }
    }

    return { created: 0, flagged, slotsConsidered: 0, mealsUsable: 0, skipped: null }
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
