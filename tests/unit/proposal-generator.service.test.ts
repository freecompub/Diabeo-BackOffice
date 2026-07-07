/**
 * Tests — US-2651 générateur ICR (`proposalGeneratorService.generateForPatient`).
 *
 * Sécurité clinique testée : routage par mode (basalBolus seul), deadband post-prandial asymétrique
 * (plafond/borne basse), resserrement grossesse, portes qualité (glucides/bolus/pré-repas), bucketing
 * à l'heure réelle, et non-fatalité des rejets fail-closed de `createEngineProposal`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/treatment-mode.service", () => ({
  treatmentModeService: { resolveTreatmentMode: vi.fn() },
}))
vi.mock("@/lib/services/insulin-therapy.service", () => ({
  insulinTherapyService: { getSettings: vi.fn() },
}))
vi.mock("@/lib/services/meal-trends.service", () => ({
  mealtimePattern: { dailyJournal: vi.fn(), fastingTrend: vi.fn() },
}))
vi.mock("@/lib/services/adjustment.service", () => ({
  adjustmentService: { createEngineProposal: vi.fn() },
}))
// Verrou advisory : par défaut « acquis » → exécute le travail. Surchargé pour le cas concurrent.
vi.mock("@/lib/db/cron-lock", () => ({
  withSessionAdvisoryLock: vi.fn((_key: string, fn: () => Promise<unknown>) => fn()),
}))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("@/lib/services/clinical-review-flag.service", () => ({
  clinicalReviewFlagService: { raise: vi.fn().mockResolvedValue({ flagId: "f1", created: true }) },
}))

import { proposalGeneratorService } from "@/lib/services/proposal-generator.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { mealtimePattern } from "@/lib/services/meal-trends.service"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { withSessionAdvisoryLock } from "@/lib/db/cron-lock"
import { auditService } from "@/lib/services/audit.service"
import { clinicalReviewFlagService } from "@/lib/services/clinical-review-flag.service"
import { objectivesService } from "@/lib/services/objectives.service"

const lock = vi.mocked(withSessionAdvisoryLock)
const auditLog = vi.mocked(auditService.log)
const raiseFlag = vi.mocked(clinicalReviewFlagService.raise)
const mode = vi.mocked(treatmentModeService.resolveTreatmentMode)
const getSettings = vi.mocked(insulinTherapyService.getSettings)
const dailyJournal = vi.mocked(mealtimePattern.dailyJournal)
const fastingTrend = vi.mocked(mealtimePattern.fastingTrend)
const createEngine = vi.mocked(adjustmentService.createEngineProposal)

/** Repas exploitable par défaut : midi (13 h), glucides/bolus OK, pré-repas 1,0 g/L (en bande). */
function meal(over: Partial<Record<string, unknown>> = {}) {
  return {
    mealId: "m", dayIso: "2026-07-01", localHour: 13, moment: "noon",
    preMgdl: 100, postMgdl: 200, nadirMgdl: 160, carbs: 45, bolus: 6, ...over,
  } as never
}

function setup(opts: {
  mode?: "basalBolus" | "fixedDose" | "nonInsulin"
  pathology?: string
  pregnancyMode?: boolean
  carbRatios?: { startHour: number; endHour: number; gramsPerUnit: number }[]
  meals?: unknown[]
  basalConfig?: { configType: string; pumpSlots: { id: string; rate: number; startHour: number; endHour: number }[] }
  glucoseTargets?: { targetGlucose: number }[]
  fasting?: { fastingMgdl: number | null; nocturnalNadirMgdl: number | null }[]
} = {}) {
  mode.mockResolvedValue({ mode: opts.mode ?? "basalBolus", coherent: true } as never)
  getSettings.mockResolvedValue({
    carbRatios: opts.carbRatios ?? [{ startHour: 12, endHour: 14, gramsPerUnit: 10 }],
    basalConfiguration: opts.basalConfig
      ? {
          configType: opts.basalConfig.configType,
          pumpSlots: opts.basalConfig.pumpSlots.map((s) => ({
            id: s.id, rate: s.rate,
            startTime: new Date(Date.UTC(1970, 0, 1, s.startHour)),
            endTime: new Date(Date.UTC(1970, 0, 1, s.endHour)),
          })),
        }
      : null,
    glucoseTargets: opts.glucoseTargets ?? [],
  } as never)
  prismaMock.patient.findFirst.mockResolvedValue({
    pathology: opts.pathology ?? "DT1", pregnancyMode: opts.pregnancyMode ?? false,
  } as never)
  dailyJournal.mockResolvedValue((opts.meals ?? [meal(), meal(), meal()]) as never)
  fastingTrend.mockResolvedValue((opts.fasting ?? []) as never)
  createEngine.mockResolvedValue({ id: "e1" } as never)
}

describe("proposalGeneratorService.generateForPatient", () => {
  beforeEach(() => vi.clearAllMocks())

  it("crée une proposition ICR (baisse) quand la PPG moyenne dépasse le plafond", async () => {
    setup() // 3 repas PPG 2,0 g/L > plafond DT1 1,80 → baisse
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.created).toBe(1)
    expect(createEngine).toHaveBeenCalledTimes(1)
    const input = createEngine.mock.calls[0]![0]
    expect(input).toMatchObject({
      parameterType: "insulinToCarbRatio", reason: "icrTooHigh",
      expectedCurrentValue: 10, carbRatioSlotStart: 12, carbRatioSlotEnd: 14,
      analysisPeriod: "14d",
    })
    expect(input.proposedValue).toBeLessThan(10) // baisse ICR
  })

  it("ne fait rien hors mode basalBolus (fixedDose/nonInsulin)", async () => {
    setup({ mode: "fixedDose" })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.skipped).toBe("mode")
    expect(createEngine).not.toHaveBeenCalled()
  })

  it("deadband : PPG moyenne entre borne basse et plafond → aucune proposition", async () => {
    setup({ meals: [meal({ postMgdl: 150 }), meal({ postMgdl: 150 }), meal({ postMgdl: 150 })] }) // 1,5 g/L
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.created).toBe(0)
    expect(createEngine).not.toHaveBeenCalled()
  })

  it("US-2653 haute variabilité (moyenne > plafond + hypos récurrentes) → FLAG, pas de dose", async () => {
    setup({ meals: [
      meal({ postMgdl: 200, nadirMgdl: 60 }), meal({ postMgdl: 200, nadirMgdl: 60 }), meal({ postMgdl: 200, nadirMgdl: 60 }),
    ] }) // PPG 2,0 > plafond 1,80 MAIS nadirs 0,60 → récurrent
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.flagged).toBe(1)
    expect(res.created).toBe(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityPostMeal", 99, undefined)
    expect(createEngine).not.toHaveBeenCalled()
  })

  it("US-2653 dans la bande + hypos récurrentes → dé-escalade ICR (hausse +10 %, icrTooLow)", async () => {
    setup({ meals: [
      meal({ postMgdl: 140, nadirMgdl: 60 }), meal({ postMgdl: 140, nadirMgdl: 60 }), meal({ postMgdl: 140, nadirMgdl: 60 }),
    ] }) // PPG 1,40 dans [1,00 ; 1,80] + nadirs 0,60 → dé-escalade
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.created).toBe(1)
    expect(raiseFlag).not.toHaveBeenCalled()
    const input = createEngine.mock.calls[0]![0]
    expect(input.reason).toBe("icrTooLow")
    expect(input.proposedValue).toBeGreaterThan(10) // hausse ICR = moins d'insuline
  })

  it("US-2653 fallback : moyenne juste sous la borne (deadband < 2 % → null) + hypos récurrentes → dé-escalade", async () => {
    // PPG 0,99 g/L < borne 1,00 : le deadband donne +1 % → null ; hypos récurrentes → fallback +10 %.
    setup({ meals: [
      meal({ postMgdl: 99, nadirMgdl: 60 }), meal({ postMgdl: 99, nadirMgdl: 60 }), meal({ postMgdl: 99, nadirMgdl: 60 }),
    ] })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.created).toBe(1)
    const input = createEngine.mock.calls[0]![0]
    expect(input.reason).toBe("icrTooLow")
    expect(input.proposedValue).toBe(11) // dé-escalade fixe +10 %, pas le +1 % (null) du deadband
  })

  it("US-2653 dans la bande SANS hypo récurrente → aucune proposition ni flag", async () => {
    setup({ meals: [meal({ postMgdl: 140 }), meal({ postMgdl: 140 }), meal({ postMgdl: 140 })] }) // nadir défaut 160
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res).toMatchObject({ created: 0, flagged: 0 })
    expect(createEngine).not.toHaveBeenCalled()
    expect(raiseFlag).not.toHaveBeenCalled()
  })

  it("porte qualité : repas sans glucides / bolus / pré-repas hors bande → exclus", async () => {
    setup({ meals: [
      meal({ carbs: 0 }),          // pas de glucides
      meal({ bolus: null }),       // pas de bolus
      meal({ preMgdl: 220 }),      // pré-repas 2,2 g/L (correction incluse) hors bande
    ] })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.mealsUsable).toBe(0)
    expect(createEngine).not.toHaveBeenCalled()
  })

  it("grossesse : un DT1 enceinte utilise le plafond resserré (1,40) → propose là où l'adulte ne le ferait pas", async () => {
    // PPG 1,55 g/L : > plafond grossesse 1,40 (baisse) mais dans le deadband adulte [1,00 ; 1,80].
    setup({ pregnancyMode: true, meals: [meal({ postMgdl: 155 }), meal({ postMgdl: 155 }), meal({ postMgdl: 155 })] })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.created).toBe(1)
    expect(createEngine.mock.calls[0]![0].reason).toBe("icrTooHigh")
  })

  it("un rejet fail-closed de createEngineProposal n'est pas fatal (run continue, created = 0)", async () => {
    setup()
    createEngine.mockRejectedValue(new Error("duplicatePendingProposal"))
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.created).toBe(0)
    expect(res.slotsConsidered).toBe(1) // le créneau a bien été analysé
  })

  it("porte qualité GROSSESSE : pré-repas 1,30 g/L exclu (borne 1,10) là où l'adulte l'accepterait", async () => {
    const mk = () => [meal({ preMgdl: 130 }), meal({ preMgdl: 130 }), meal({ preMgdl: 130 })] // 1,30 g/L
    setup({ pregnancyMode: true, meals: mk() })
    expect((await proposalGeneratorService.generateForPatient(1, 99)).mealsUsable).toBe(0) // 1,30 > 1,10

    vi.clearAllMocks()
    setup({ pregnancyMode: false, meals: mk() })
    expect((await proposalGeneratorService.generateForPatient(1, 99)).mealsUsable).toBe(3) // 1,30 ≤ 1,40
  })

  it("direction HAUSSE : PPG moyenne sous la borne basse → icrTooLow (moins d'insuline)", async () => {
    setup({ meals: [meal({ postMgdl: 80 }), meal({ postMgdl: 80 }), meal({ postMgdl: 80 })] }) // 0,80 g/L < 1,00
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.created).toBe(1)
    const input = createEngine.mock.calls[0]![0]
    expect(input.reason).toBe("icrTooLow")
    expect(input.proposedValue).toBeGreaterThan(10) // hausse ICR
  })

  it("bucketing : route au bon créneau à l'heure réelle ; un repas hors créneau est ignoré", async () => {
    const carbRatios = [
      { startHour: 8, endHour: 12, gramsPerUnit: 12 },
      { startHour: 12, endHour: 16, gramsPerUnit: 10 },
    ]
    const meals = [
      meal({ localHour: 9, postMgdl: 200 }), meal({ localHour: 9, postMgdl: 200 }), meal({ localHour: 9, postMgdl: 200 }),
      meal({ localHour: 20, postMgdl: 200 }), meal({ localHour: 20, postMgdl: 200 }), meal({ localHour: 20, postMgdl: 200 }),
    ]
    setup({ carbRatios, meals })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.mealsUsable).toBe(6)
    expect(res.slotsConsidered).toBe(1) // seul [8,12) a ≥3 repas ; les 20 h ne matchent aucun créneau
    expect(createEngine).toHaveBeenCalledTimes(1)
    expect(createEngine.mock.calls[0]![0]).toMatchObject({
      carbRatioSlotStart: 8, carbRatioSlotEnd: 12, expectedCurrentValue: 12,
    })
  })
})

describe("proposalGeneratorService.generateForPatient — chemin basal (US-2651)", () => {
  beforeEach(() => vi.clearAllMocks())

  const NOCTURNAL = { id: "noct", rate: 0.8, startHour: 0, endHour: 6 } // couvre 05:00
  const pump = (pumpSlots = [NOCTURNAL]) => ({ configType: "pump", pumpSlots })
  const basalCalls = () =>
    createEngine.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((a) => a.parameterType === "basalRate")
  const fastingNights = (fastingMgdl: number, nocturnalNadirMgdl: number | null) =>
    Array.from({ length: 3 }, () => ({ fastingMgdl, nocturnalNadirMgdl }))

  it("pompe : à jeun haut + ≥3 nadirs sûrs → proposition basalRate (hausse) sur le créneau nocturne", async () => {
    setup({ meals: [], basalConfig: pump(), fasting: fastingNights(150, 120) }) // 1,50 g/L vs défaut 1,00
    await proposalGeneratorService.generateForPatient(1, 99)
    const basal = basalCalls()
    expect(basal).toHaveLength(1)
    expect(basal[0]).toMatchObject({ pumpBasalSlotId: "noct", reason: "basalTooLow", expectedCurrentValue: 0.8 })
  })

  it("garde Somogyi : hausse SANS couverture nadir nocturne (< 3 nuits) → supprimée", async () => {
    setup({ meals: [], basalConfig: pump(), fasting: fastingNights(150, null) }) // aucun nadir CGM
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(basalCalls()).toHaveLength(0)
  })

  it("baisse (à jeun bas) autorisée même sans couverture nadir (sens sûr)", async () => {
    setup({ meals: [], basalConfig: pump(), fasting: fastingNights(70, null) }) // 0,70 g/L < défaut 1,00
    await proposalGeneratorService.generateForPatient(1, 99)
    const basal = basalCalls()
    expect(basal).toHaveLength(1)
    expect(basal[0]).toMatchObject({ reason: "basalTooHigh" })
  })

  it("stylo/MDI (single_injection) : aucune proposition basalRate (dose fixe = autre chemin)", async () => {
    setup({ meals: [], basalConfig: { configType: "single_injection", pumpSlots: [] }, fasting: fastingNights(150, 120) })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(basalCalls()).toHaveLength(0)
  })

  it("cible individualisée plausible utilisée (JAMAIS titrLow) : cible 1,20 → à jeun 1,10 devient une BAISSE", async () => {
    // Avec le défaut 1,00, 1,10 serait une hausse ; la cible individualisée 1,20 (dans la bande) l'inverse.
    setup({ meals: [], basalConfig: pump(), glucoseTargets: [{ targetGlucose: 120 }], fasting: fastingNights(110, 100) })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(basalCalls()[0]).toMatchObject({ reason: "basalTooHigh" })
  })

  it("couplage ICR (limite connue) : pompe avec basale mais SANS carb-ratios → early-return, aucune proposition basale", async () => {
    setup({ carbRatios: [], basalConfig: pump(), fasting: fastingNights(150, 120) })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.skipped).toBe("noCarbRatios") // le early-return ICR gate le chemin basal
    expect(basalCalls()).toHaveLength(0)
  })
})

describe("proposalGeneratorService.generateOrientationFlags (mode c — nonInsulin)", () => {
  const DAY = 86_400_000
  beforeEach(() => vi.clearAllMocks())

  afterEach(() => vi.restoreAllMocks()) // désinstalle le spy computeTirPercent

  function setupNonInsulin(
    hba1c: { gly?: Date | null; evt?: Date | null; value?: number } = {},
    tir: number | null = null, // TIR retourné par computeTirPercent (null = capture insuffisante)
    patient: { pathology?: string; pregnancyMode?: boolean } = {},
    objectiveHba1c: number | null = null, // cible individualisée (AnnexObjective)
  ) {
    const v = hba1c.value ?? 6 // valeur HbA1c par défaut (< 8 → pas de flag aboveTarget)
    mode.mockResolvedValue({ mode: "nonInsulin", coherent: true } as never)
    prismaMock.glycemiaEntry.findFirst.mockResolvedValue(hba1c.gly ? ({ date: hba1c.gly, hba1c: v } as never) : null)
    prismaMock.diabetesEvent.findFirst.mockResolvedValue(hba1c.evt ? ({ eventDate: hba1c.evt, hba1c: v } as never) : null)
    prismaMock.patient.findFirst.mockResolvedValue({
      pathology: patient.pathology ?? "DT2", pregnancyMode: patient.pregnancyMode ?? false,
    } as never)
    prismaMock.annexObjective.findUnique.mockResolvedValue(objectiveHba1c !== null ? ({ objectiveHba1c } as never) : null)
    vi.spyOn(objectivesService, "computeTirPercent").mockResolvedValue(tir)
  }

  it("nonInsulin → route vers les flags d'orientation, JAMAIS une dose (frontière MDR)", async () => {
    setupNonInsulin({ evt: new Date() }) // HbA1c récente → pas de flag, mais surtout aucune dose
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.created).toBe(0)
    expect(createEngine).not.toHaveBeenCalled()
  })

  it("HbA1c absente → flag hba1cStale", async () => {
    setupNonInsulin({}) // aucune HbA1c
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.flagged).toBe(1)
    expect(raiseFlag).toHaveBeenCalledWith(1, "hba1cStale", 99, undefined)
  })

  it("HbA1c périmée (> 180 j) → flag hba1cStale", async () => {
    setupNonInsulin({ evt: new Date(Date.now() - 200 * DAY) })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.flagged).toBe(1)
    expect(raiseFlag).toHaveBeenCalledWith(1, "hba1cStale", 99, undefined)
  })

  it("HbA1c récente (< 180 j) → aucun flag", async () => {
    setupNonInsulin({ gly: new Date(Date.now() - 30 * DAY) })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.flagged).toBe(0)
    expect(raiseFlag).not.toHaveBeenCalled()
  })

  it("prend la PLUS RÉCENTE des 2 sources (carnet récent + événement vieux → pas de flag)", async () => {
    // gly 30 j (récent) + evt 200 j (vieux) → max = 30 j → non périmé. (Math.min → flaguerait à tort.)
    setupNonInsulin({ gly: new Date(Date.now() - 30 * DAY), evt: new Date(Date.now() - 200 * DAY) })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.flagged).toBe(0)
    expect(raiseFlag).not.toHaveBeenCalled()
  })

  it("TIR < 70 % (capture suffisante) → flag tirBelowTarget", async () => {
    setupNonInsulin({ gly: new Date() }, 55) // HbA1c récente (pas de flag hba1c) + TIR 55 %
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.flagged).toBe(1)
    expect(raiseFlag).toHaveBeenCalledWith(1, "tirBelowTarget", 99, undefined)
  })

  it("TIR ≥ 70 % → aucun flag TIR", async () => {
    setupNonInsulin({ gly: new Date() }, 75)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "tirBelowTarget", 99, undefined)
  })

  it("TIR null (capture insuffisante) → aucun flag TIR", async () => {
    setupNonInsulin({ gly: new Date() }, null)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "tirBelowTarget", 99, undefined)
  })

  it("DT2 ENCEINTE → TIR scoré contre les bornes GD (pas adulte)", async () => {
    setupNonInsulin({ gly: new Date() }, 80, { pathology: "DT2", pregnancyMode: true })
    await proposalGeneratorService.generateForPatient(1, 99)
    // isPregnancy (pregnancyMode) → bornes GD, pas DT2.
    expect(vi.mocked(objectivesService.computeTirPercent)).toHaveBeenCalledWith(1, "GD")
  })

  it("TIR exactement 70 % → aucun flag (borne stricte < 70)", async () => {
    setupNonInsulin({ gly: new Date() }, 70)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "tirBelowTarget", 99, undefined)
  })

  it("HbA1c périmée + TIR < 70 → les DEUX flags (flagged = 2)", async () => {
    setupNonInsulin({ evt: new Date(Date.now() - 200 * DAY) }, 55)
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.flagged).toBe(2)
    expect(raiseFlag).toHaveBeenCalledWith(1, "hba1cStale", 99, undefined)
    expect(raiseFlag).toHaveBeenCalledWith(1, "tirBelowTarget", 99, undefined)
  })

  it("US-2651 #3b — HbA1c récente 8,5 % sans cible, sans CGM → hba1cAboveTarget (trou BGM comblé)", async () => {
    setupNonInsulin({ gly: new Date(), value: 8.5 }, null) // récente + TIR null + pas de cible
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).toHaveBeenCalledWith(1, "hba1cAboveTarget", 99, undefined)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "hba1cStale", 99, undefined)
  })

  it("HbA1c 7,4 % sans cible → pas de flag (< défaut 8,0)", async () => {
    setupNonInsulin({ gly: new Date(), value: 7.4 }, null)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "hba1cAboveTarget", 99, undefined)
  })

  it("cible individualisée 6,5 : 7,4 % > 6,5+0,5 → flag", async () => {
    setupNonInsulin({ gly: new Date(), value: 7.4 }, null, {}, 6.5)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).toHaveBeenCalledWith(1, "hba1cAboveTarget", 99, undefined)
  })

  it("cible individualisée 6,5 : 6,9 % dans la marge +0,5 → pas de flag", async () => {
    setupNonInsulin({ gly: new Date(), value: 6.9 }, null, {}, 6.5)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "hba1cAboveTarget", 99, undefined)
  })

  it("HbA1c périmée 9,0 % → hba1cStale, PAS hba1cAboveTarget (le périmé appartient à hba1cStale)", async () => {
    setupNonInsulin({ evt: new Date(Date.now() - 200 * DAY), value: 9.0 }, null)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).toHaveBeenCalledWith(1, "hba1cStale", 99, undefined)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "hba1cAboveTarget", 99, undefined)
  })

  it("grossesse : 6,4 % sans cible → flag (défaut grossesse 6,0)", async () => {
    setupNonInsulin({ gly: new Date(), value: 6.4 }, null, { pregnancyMode: true })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).toHaveBeenCalledWith(1, "hba1cAboveTarget", 99, undefined)
  })

  it("cible importée implausible (53) → ignorée, repli défaut 8,0 (fail-loud) : 9,0 % → flag", async () => {
    setupNonInsulin({ gly: new Date(), value: 9.0 }, null, {}, 53)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).toHaveBeenCalledWith(1, "hba1cAboveTarget", 99, undefined)
  })

  it("la VALEUR suit le record à la date MAX (récent 7,0 vs vieux 9,0 → prend 7,0, aucun flag)", async () => {
    // Sources en conflit : carnet récent (30 j, 7,0) + événement vieux (200 j, 9,0). La date max est le
    // carnet → valeur 7,0 < 8,0 (pas de aboveTarget) ET récent (pas de hba1cStale). Si le code prenait la
    // valeur MAX (9,0) → aboveTarget à tort ; s'il prenait la date max de l'événement → hba1cStale à tort.
    mode.mockResolvedValue({ mode: "nonInsulin", coherent: true } as never)
    prismaMock.glycemiaEntry.findFirst.mockResolvedValue({ date: new Date(Date.now() - 30 * DAY), hba1c: 7.0 } as never)
    prismaMock.diabetesEvent.findFirst.mockResolvedValue({ eventDate: new Date(Date.now() - 200 * DAY), hba1c: 9.0 } as never)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT2", pregnancyMode: false } as never)
    prismaMock.annexObjective.findUnique.mockResolvedValue(null)
    vi.spyOn(objectivesService, "computeTirPercent").mockResolvedValue(null)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "hba1cAboveTarget", 99, undefined)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "hba1cStale", 99, undefined)
  })

  it("valeur exactement = cible (8,0 == défaut 8,0) → pas de flag (borne stricte >)", async () => {
    setupNonInsulin({ gly: new Date(), value: 8.0 }, null)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "hba1cAboveTarget", 99, undefined)
  })
})

describe("proposalGeneratorService.generateForAllPatients (cron)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("boucle le portefeuille actif (deletedAt null + user actif) → agrège created/processed", async () => {
    setup() // par patient : basalBolus + 3 repas PPG 2,0 → 1 proposition
    prismaMock.patient.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }] as never)
    const res = await proposalGeneratorService.generateForAllPatients()
    expect(res.processed).toBe(2)
    expect(res.created).toBe(2)
    expect(res.errored).toBe(0)
    expect(res.skippedConcurrent).toBe(false)
    expect(prismaMock.patient.findMany.mock.calls[0]![0]!.where).toMatchObject({
      deletedAt: null, user: { status: "active" },
    })
    // Marqueur d'audit RUN-LEVEL immuable (HDS) : métriques + acteur système null.
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: null, action: "CREATE", resource: "ADJUSTMENT_PROPOSAL", resourceId: "cron",
      metadata: expect.objectContaining({ kind: "proposal.generator.cron.run", processed: 2, created: 2, errored: 0 }),
    }))
  })

  it("verrou non acquis (run concurrent) → skippedConcurrent + audit skipped_locked", async () => {
    lock.mockResolvedValueOnce(null) // withSessionAdvisoryLock renvoie null
    const res = await proposalGeneratorService.generateForAllPatients()
    expect(res.skippedConcurrent).toBe(true)
    expect(res.processed).toBe(0)
    expect(prismaMock.patient.findMany).not.toHaveBeenCalled()
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ kind: "proposal.generator.cron.skipped_locked" }),
    }))
  })

  it("portefeuille vide → processed 0, aucune erreur, run tracé", async () => {
    setup()
    prismaMock.patient.findMany.mockResolvedValue([] as never)
    const res = await proposalGeneratorService.generateForAllPatients()
    expect(res).toMatchObject({ processed: 0, created: 0, errored: 0, skippedConcurrent: false })
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ kind: "proposal.generator.cron.run", processed: 0 }),
    }))
  })

  it("un patient skippé par mode (fixedDose) ne gonfle PAS errored", async () => {
    setup({ mode: "fixedDose" }) // generateForPatient renvoie skipped:'mode' sans lever
    prismaMock.patient.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }] as never)
    const res = await proposalGeneratorService.generateForAllPatients()
    expect(res).toMatchObject({ processed: 2, created: 0, errored: 0 })
  })

  it("isolation per-patient : une erreur infra sur un patient n'arrête pas le portefeuille", async () => {
    setup()
    prismaMock.patient.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }] as never)
    getSettings.mockRejectedValueOnce(new Error("db down")) // 1er patient échoue, 2e OK
    const res = await proposalGeneratorService.generateForAllPatients()
    expect(res.processed).toBe(2)
    expect(res.errored).toBe(1)
    expect(res.created).toBe(1)
  })
})
