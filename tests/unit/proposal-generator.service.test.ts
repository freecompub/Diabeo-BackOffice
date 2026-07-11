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
  mealtimePattern: { dailyJournal: vi.fn(), fastingTrend: vi.fn(), correctionTrend: vi.fn() },
  // US-2653 (fix cooldown) — le générateur importe `localDay` pour aligner le cutoff post-changement
  // sur la base jour des observations. En test : jour UTC de l'instant (suffit aux comparaisons de fixtures).
  localDay: (ms: number) => new Date(ms).toISOString().slice(0, 10),
}))
vi.mock("@/lib/services/adjustment.service", () => ({
  adjustmentService: { createEngineProposal: vi.fn() },
}))
vi.mock("@/lib/services/analytics.service", () => ({
  analyticsService: { fixedDoseTrend: vi.fn() },
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
import { analyticsService } from "@/lib/services/analytics.service"
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
const correctionTrend = vi.mocked(mealtimePattern.correctionTrend)
const fixedDoseTrend = vi.mocked(analyticsService.fixedDoseTrend)
const createEngine = vi.mocked(adjustmentService.createEngineProposal)

const DAY_MS = 86_400_000
/** Jour ISO (UTC) il y a `n` jours — pour dater les observations relativement à « maintenant »
 *  (le filtre post-changement US-2653 compare `dayIso > cutoff`). Défaut fixtures : hier. */
const isoDaysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10)

/** `number[]` → forme `{gl, dayIso}[]` attendue de `fixedDoseTrend` (US-2653 fix). `dayIso` = hier par défaut,
 *  ou une liste de jours fournie (pour dater les relevés dans les tests post-changement). */
const toTroughs = (
  m: Record<string, number[]>,
  days?: string[],
): Record<string, { gl: number; dayIso: string }[]> =>
  Object.fromEntries(
    Object.entries(m).map(([k, gls]) => [k, gls.map((gl, i) => ({ gl, dayIso: days?.[i] ?? isoDaysAgo(1) }))]),
  )

/** Repas exploitable par défaut : midi (13 h), glucides/bolus OK, pré-repas 1,0 g/L (en bande).
 *  `dayIso` = hier par défaut (récent → passe le filtre post-changement quand aucun changement récent). */
function meal(over: Partial<Record<string, unknown>> = {}) {
  return {
    mealId: "m", dayIso: isoDaysAgo(1), localHour: 13, moment: "noon",
    preMgdl: 100, postMgdl: 200, nadirMgdl: 160, carbs: 45, bolus: 6, ...over,
  } as never
}

function setup(opts: {
  mode?: "basalBolus" | "fixedDose" | "nonInsulin"
  pathology?: string
  pregnancyMode?: boolean
  carbRatios?: { startHour: number; endHour: number; gramsPerUnit: number }[]
  meals?: unknown[]
  // US-2659 — `dailyDose` (stylo single_injection) + `pumpSlots` optionnels selon le mode de délivrance.
  basalConfig?: { configType: string; pumpSlots?: { id: string; rate: number; startHour: number; endHour: number }[]; dailyDose?: number }
  glucoseTargets?: { targetGlucose: number }[]
  fasting?: { fastingMgdl: number | null; nocturnalNadirMgdl: number | null; dayIso?: string }[]
  sensitivityFactors?: { startHour: number; endHour: number; sensitivityFactorGl: number }[]
  corrections?: { localHour: number; postGlucoseGl: number; targetGl: number; nadirGl: number | null }[]
} = {}) {
  mode.mockResolvedValue({ mode: opts.mode ?? "basalBolus", coherent: true } as never)
  getSettings.mockResolvedValue({
    carbRatios: opts.carbRatios ?? [{ startHour: 12, endHour: 14, gramsPerUnit: 10 }],
    sensitivityFactors: opts.sensitivityFactors ?? [],
    basalConfiguration: opts.basalConfig
      ? {
          configType: opts.basalConfig.configType,
          dailyDose: opts.basalConfig.dailyDose ?? null,
          morningDose: null,
          eveningDose: null,
          pumpSlots: (opts.basalConfig.pumpSlots ?? []).map((s) => ({
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
  correctionTrend.mockResolvedValue((opts.corrections ?? []) as never)
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

  it("mode fixedDose SANS dose configurée → skipped noFixedDose (aucune proposition)", async () => {
    mode.mockResolvedValue({ mode: "fixedDose", coherent: true } as never)
    prismaMock.fixedDoseSlot.findMany.mockResolvedValue([] as never)
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.skipped).toBe("noFixedDose")
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
    Array.from({ length: 3 }, (_, i) => ({ fastingMgdl, nocturnalNadirMgdl, dayIso: isoDaysAgo(i + 1) }))

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

describe("proposalGeneratorService.generateForPatient — basale STYLO single_injection (US-2659 S1)", () => {
  beforeEach(() => vi.clearAllMocks())

  const stylo = (dailyDose: number) => ({ configType: "single_injection", dailyDose })
  // Fixture à jeun : `nocturnalNadirMgdl` null ⇒ simule le BGM (pas de couverture nocturne). `dayIso` daté
  // (jours récents) → robuste au filtre POST-changement (fix M1 : la titration juge l'à jeun post-cutoff).
  const nights = (fastingMgdl: number, nadirMgdl: number | null, n = 3) =>
    Array.from({ length: n }, (_, i) => ({ fastingMgdl, nocturnalNadirMgdl: nadirMgdl, dayIso: isoDaysAgo(i + 1) }))
  const styloCalls = () =>
    createEngine.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((a) => a.parameterType === "basalRate" && a.basalDoseKind === "daily")

  it("AC-1 HAUSSE : à jeun HAUT + couverture nocturne CGM saine → proposition daily basalTooLow (U totales)", async () => {
    setup({ basalConfig: stylo(22), fasting: nights(150, 120) }) // 1,50 g/L > T+0,30 ; nadir 1,20 sain
    await proposalGeneratorService.generateForPatient(1, 99)
    const calls = styloCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ reason: "basalTooLow", expectedCurrentValue: 22, basalDoseKind: "daily" })
    expect(Number(calls[0].proposedValue)).toBeGreaterThan(22)
    expect(raiseFlag).not.toHaveBeenCalled()
  })

  it("AC-4 garde BGM : à jeun HAUT mais AUCUN nadir nocturne (BGM) → hausse refusée → FLAG, pas de dose", async () => {
    setup({ basalConfig: stylo(22), fasting: nights(150, null) }) // à jeun présent, nadir null (BGM)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(styloCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "nocturnalHypoHighFasting", 99, undefined)
  })

  it("HOLD : à jeun dans la bande [T−0,20 ; T+0,30] → aucune proposition ni flag", async () => {
    setup({ basalConfig: stylo(22), fasting: nights(105, 120) }) // 1,05 g/L in-band
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(styloCalls()).toHaveLength(0)
    expect(raiseFlag).not.toHaveBeenCalled()
  })

  it("BAISSE treat-to-target : à jeun SOUS la bande, pas d'hypo récurrente → daily basalTooHigh (sens sûr, sans couverture)", async () => {
    setup({ basalConfig: stylo(22), fasting: nights(65, null) }) // 0,65 g/L < T−0,20 ; BGM
    await proposalGeneratorService.generateForPatient(1, 99)
    const calls = styloCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ reason: "basalTooHigh" })
    expect(Number(calls[0].proposedValue)).toBeLessThan(22)
  })

  it("AC-5 Somogyi : à jeun HAUT + hypo nocturne récurrente → FLAG nocturnalHypoHighFasting, JAMAIS une baisse", async () => {
    setup({ basalConfig: stylo(22), fasting: [
      { fastingMgdl: 150, nocturnalNadirMgdl: 50, dayIso: isoDaysAgo(1) }, { fastingMgdl: 150, nocturnalNadirMgdl: 50, dayIso: isoDaysAgo(2) }, { fastingMgdl: 150, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(3) },
    ] })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(styloCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "nocturnalHypoHighFasting", 99, undefined)
  })

  it("AC-3 dé-escalade : à jeun IN-BAND + hypo nocturne récurrente → daily basalTooHigh (−min(20 %, 4 U))", async () => {
    setup({ basalConfig: stylo(22), fasting: [
      { fastingMgdl: 105, nocturnalNadirMgdl: 60, dayIso: isoDaysAgo(1) }, { fastingMgdl: 105, nocturnalNadirMgdl: 60, dayIso: isoDaysAgo(2) }, { fastingMgdl: 105, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(3) },
    ] })
    await proposalGeneratorService.generateForPatient(1, 99)
    const calls = styloCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ reason: "basalTooHigh", basalDoseKind: "daily" })
    expect(Number(calls[0].proposedValue)).toBe(18) // 22 − min(4,4) = 18
  })

  it("dailyDose non configurée (null) → aucune proposition, aucun crash", async () => {
    setup({ basalConfig: { configType: "single_injection" }, fasting: nights(150, 120) })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(styloCalls()).toHaveLength(0)
    expect(res).toBeDefined()
  })

  it("non-régression : un patient POMPE n'emprunte pas le chemin stylo (basalDoseKind jamais posé)", async () => {
    setup({ basalConfig: { configType: "pump", pumpSlots: [{ id: "noct", rate: 0.8, startHour: 0, endHour: 6 }] }, fasting: nights(150, 120) })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(styloCalls()).toHaveLength(0) // le chemin pompe utilise pumpBasalSlotId, jamais basalDoseKind
  })

  it("fix M1 : à jeun HAUTS PÉRIMÉS (pré-changement) → PAS de hausse (la titration juge le POST-changement)", async () => {
    // Changement accepté il y a 100 h (> 72 h → cooldown écoulé). À jeun post-changement IN-BAND (1,05) mais
    // pré-changement HAUTS (1,80). Sans le fix (moyenne 7 j pleine = 1,42 > T+0,30), une 2e hausse s'empilerait.
    setup({ basalConfig: stylo(22), fasting: [
      { fastingMgdl: 105, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(1) },
      { fastingMgdl: 105, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(2) },
      { fastingMgdl: 105, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(3) },
      { fastingMgdl: 180, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(5) },
      { fastingMgdl: 180, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(6) },
      { fastingMgdl: 180, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(7) },
    ] })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date(Date.now() - 100 * 3_600_000) } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(styloCalls()).toHaveLength(0) // à jeun post-changement in-band → HOLD, pas d'empilement
  })

  it("fix M-med#1 : hypo sévère À JEUN (BGM sans nadir nocturne) pendant HOLD → FLAG (Q6b sur à jeun ∪ nocturne)", async () => {
    // BGM (nadirs null) : un relevé réveil sévère 0,50 g/L coexiste avec une moyenne in-band → sans le fix
    // (severeNoct nocturne seul) l'événement était tu ; le fix surface la sévérité à jeun.
    setup({ basalConfig: stylo(22), fasting: [
      { fastingMgdl: 50, nocturnalNadirMgdl: null, dayIso: isoDaysAgo(1) },
      { fastingMgdl: 130, nocturnalNadirMgdl: null, dayIso: isoDaysAgo(2) },
      { fastingMgdl: 130, nocturnalNadirMgdl: null, dayIso: isoDaysAgo(3) },
    ] })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(styloCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "nocturnalHypoHighFasting", 99, undefined)
  })
})

describe("proposalGeneratorService.generateForPatient — mode fixedDose (US-2652)", () => {
  beforeEach(() => vi.clearAllMocks())

  const fixedCalls = () =>
    createEngine.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((a) => a.parameterType === "fixedDose")
  const emptyTroughs = { morning: [] as number[], noon: [] as number[], evening: [] as number[], night: [] as number[] }
  function setupFixed(opts: {
    slots?: { moment: string; valueU: number }[]
    troughs?: Record<string, number[]>
    target?: { targetGlucose: number } | null
    pregnancyMode?: boolean
    pathology?: string
  } = {}) {
    mode.mockResolvedValue({ mode: "fixedDose", coherent: true } as never)
    prismaMock.fixedDoseSlot.findMany.mockResolvedValue((opts.slots ?? []) as never)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: opts.pathology ?? "DT2", pregnancyMode: opts.pregnancyMode ?? false } as never)
    prismaMock.glucoseTarget.findFirst.mockResolvedValue((opts.target ?? null) as never)
    fixedDoseTrend.mockResolvedValue(toTroughs(opts.troughs ?? emptyTroughs) as never)
    createEngine.mockResolvedValue({ id: "e1" } as never)
  }

  it("dose fixe : creux au-dessus de la cible → proposition fixedDoseTooLow (hausse) par moment", async () => {
    setupFixed({ slots: [{ moment: "morning", valueU: 10 }], troughs: { ...emptyTroughs, morning: [1.8, 1.8, 1.8] } })
    await proposalGeneratorService.generateForPatient(1, 99)
    const fixed = fixedCalls()
    expect(fixed).toHaveLength(1)
    expect(fixed[0]).toMatchObject({ moment: "morning", reason: "fixedDoseTooLow", expectedCurrentValue: 10 })
  })

  it("< 3 creux dans le moment → aucune proposition (plancher analyseur)", async () => {
    setupFixed({ slots: [{ moment: "morning", valueU: 10 }], troughs: { ...emptyTroughs, morning: [1.8, 1.8] } })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(fixedCalls()).toHaveLength(0)
  })

  it("garde hypo : un creux sévère (0,50) supprime la hausse de dose", async () => {
    setupFixed({ slots: [{ moment: "morning", valueU: 10 }], troughs: { ...emptyTroughs, morning: [1.8, 1.8, 0.5] } })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(fixedCalls()).toHaveLength(0)
  })

  it("aucune dose fixe configurée → EMPTY(noFixedDose), aucune proposition", async () => {
    setupFixed({ slots: [] })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.skipped).toBe("noFixedDose")
    expect(fixedCalls()).toHaveLength(0)
  })

  it("cible individualisée utilisée (jamais titrLow) : cible 1,30 → creux 1,20 → BAISSE", async () => {
    setupFixed({
      slots: [{ moment: "evening", valueU: 12 }],
      troughs: { ...emptyTroughs, evening: [1.2, 1.2, 1.2] },
      target: { targetGlucose: 130 }, // 1,30 g/L
    })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(fixedCalls()[0]).toMatchObject({ moment: "evening", reason: "fixedDoseTooHigh" })
  })

  it("patient soft-deleted (findFirst null) → EMPTY(noPatient), aucune proposition (fail-closed RGPD)", async () => {
    setupFixed({ slots: [{ moment: "morning", valueU: 10 }], troughs: { ...emptyTroughs, morning: [1.8, 1.8, 1.8] } })
    prismaMock.patient.findFirst.mockResolvedValue(null as never)
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.skipped).toBe("noPatient")
    expect(fixedCalls()).toHaveLength(0)
  })
})

describe("proposalGeneratorService.generateForPatient — chemin ISF (US-2651)", () => {
  beforeEach(() => vi.clearAllMocks())

  const ISF_SLOT = { startHour: 8, endHour: 12, sensitivityFactorGl: 0.5 }
  const isfCalls = () =>
    createEngine.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((a) => a.parameterType === "insulinSensitivityFactor")
  const corrections = (post: number, nadir: number | null, n = 4) =>
    Array.from({ length: n }, (_, i) => ({ localHour: 9, dayIso: isoDaysAgo(i), postGlucoseGl: post, targetGl: 1.2, nadirGl: nadir }))

  it("corrections au-dessus de la cible → proposition isfTooHigh (baisse) sur le créneau ISF appliqué", async () => {
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.8, 1.4) })
    await proposalGeneratorService.generateForPatient(1, 99)
    const isf = isfCalls()
    expect(isf).toHaveLength(1)
    expect(isf[0]).toMatchObject({ timeSlotStartHour: 8, timeSlotEndHour: 12, reason: "isfTooHigh", expectedCurrentValue: 0.5 })
  })

  it("garde hypo : un nadir sévère (0,50) supprime la baisse ISF", async () => {
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.8, 0.5) })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(0)
  })

  it("< 3 corrections dans le créneau → aucune proposition ISF (plancher analyseur)", async () => {
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.8, 1.4, 2) })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(0)
  })

  it("aucun créneau ISF configuré → aucune proposition ISF (même avec des corrections)", async () => {
    setup({ meals: [], sensitivityFactors: [], corrections: corrections(1.8, 1.4) })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(0)
  })

  // US-2653 — dé-escalade active + matrice post-correction.
  it("in-band + nadirs post-correction récurrents → dé-escalade ISF (hausse +10 %, isfTooLow)", async () => {
    // avgPost = cible (1,2) → analyzeIsfSlot in-band (null) ; nadirs 0,6 récurrents → dé-escalade.
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.2, 0.6) })
    await proposalGeneratorService.generateForPatient(1, 99)
    const isf = isfCalls()
    expect(isf).toHaveLength(1)
    expect(isf[0]).toMatchObject({ reason: "isfTooLow", expectedCurrentValue: 0.5, proposedValue: 0.55 })
    expect(raiseFlag).not.toHaveBeenCalled() // exclusivité : une dé-escalade OU un flag, jamais les deux
  })

  it("sous-correction moyenne + nadirs récurrents → FLAG highVariabilityPostCorrection, aucune dose", async () => {
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.8, 0.6) })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityPostCorrection", 99, undefined)
  })

  it("cooldown anti-cliquet : dernier changement accepté < 72 h → dé-escalade ISF SAUTÉE (skip silencieux)", async () => {
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.2, 0.6) })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date() } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(0)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "highVariabilityPostCorrection", 99, undefined)
  })

  it("cooldown expiré (> 72 h) → dé-escalade ISF de nouveau proposée", async () => {
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.2, 0.6) })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date(Date.now() - 80 * 3_600_000) } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(1)
  })

  it("cooldown exactement 72 h (borne stricte <) → dé-escalade proposée (pas bloquée)", async () => {
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.2, 0.6) })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date(Date.now() - 72 * 3_600_000) } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(1)
  })

  it("fix Q6a — délai écoulé (100 h) MAIS toutes les hypos datées AVANT le changement → PAS de dé-escalade (données périmées)", async () => {
    // 3 hypos récurrentes mais toutes antérieures (J-5..J-7) au dernier changement accepté (il y a 100 h ≈ J-4) :
    // la fenêtre post-changement est vide → l'analyseur ne re-titre jamais sur du pré-changement.
    const stale = Array.from({ length: 3 }, (_, i) => ({ localHour: 9, dayIso: isoDaysAgo(i + 5), postGlucoseGl: 1.2, targetGl: 1.2, nadirGl: 0.6 }))
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: stale })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date(Date.now() - 100 * 3_600_000) } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(0) // délai écoulé mais aucune observation post-changement → jamais de dose
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "highVariabilityPostCorrection", 99, undefined) // nadir 0,6 non sévère
  })

  it("fix Q6b — dé-escalade bloquée par le cooldown MAIS nadir SÉVÈRE (< 0,54 g/L) présent → FLAG (jamais silencieux)", async () => {
    // Changement accepté à l'instant → cooldown actif, dé-escalade bloquée ; mais une hypo sévère récurrente
    // ne doit jamais être tue → surfaçage en flag de revue clinique.
    const severeSet = Array.from({ length: 3 }, (_, i) => ({ localHour: 9, dayIso: isoDaysAgo(i), postGlucoseGl: 1.2, targetGl: 1.2, nadirGl: 0.5 }))
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: severeSet })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date() } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(0) // dé-escalade bloquée (cooldown actif)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityPostCorrection", 99, undefined) // sévérité surfacée (Q6b)
  })

  it("cooldown : la requête filtre status=accepted + le BON créneau (anti mauvais-créneau / anti-pending)", async () => {
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.2, 0.6) })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue(null as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(prismaMock.adjustmentProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "accepted", parameterType: "insulinSensitivityFactor", timeSlotStartHour: 8, timeSlotEndHour: 12,
          reviewedAt: { not: null }, // anti tri NULLS FIRST → une ligne acceptée sans reviewedAt ne masque pas une récente
        }),
      }),
    )
  })

  it("cooldown : une ligne acceptée à reviewedAt NULL ne bloque PAS (défensif, tri NULLS FIRST)", async () => {
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.2, 0.6) })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: null } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(1) // reviewedAt null → pas de cooldown → dé-escalade proposée
  })

  it("le cooldown NE bloque PAS l'escalade deadband (auto-limitée) : correction haute + changement récent → proposition quand même", async () => {
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.8, 1.4) }) // baisse deadband (isfTooHigh)
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date() } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(1)
    expect(isfCalls()[0]).toMatchObject({ reason: "isfTooHigh" })
  })

  it("ISF : hypo sévère post-correction ISOLÉE (in-band, non récurrente) → FLAG, aucune dose", async () => {
    const pts = [
      { localHour: 9, postGlucoseGl: 1.2, targetGl: 1.2, nadirGl: 0.5 }, // 1 sévère
      { localHour: 9, postGlucoseGl: 1.2, targetGl: 1.2, nadirGl: 1.4 },
      { localHour: 9, postGlucoseGl: 1.2, targetGl: 1.2, nadirGl: 1.4 },
    ]
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: pts })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(isfCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityPostCorrection", 99, undefined)
  })

  it("PROVENANCE : des nadirs post-REPAS récurrents ne déclenchent NI dé-escalade ISF NI basale (pas de cross-feed)", async () => {
    const hypoMeals = Array.from({ length: 3 }, () => meal({ postMgdl: 150, nadirMgdl: 60, localHour: 13 }))
    const basalCalls = () =>
      createEngine.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((a) => a.parameterType === "basalRate")
    const icrCalls = () =>
      createEngine.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((a) => a.parameterType === "insulinToCarbRatio")
    setup({
      meals: hypoMeals, // nadirs repas 0,60 récurrents (déclenchent l'ICR, PAS l'ISF/basal)
      sensitivityFactors: [ISF_SLOT], corrections: corrections(1.2, 1.4), // corrections PROPRES → pas de dé-escalade ISF
      basalConfig: { configType: "pump", pumpSlots: [{ id: "noct", rate: 0.8, startHour: 0, endHour: 6 }] },
      fasting: Array.from({ length: 3 }, (_, i) => ({ fastingMgdl: 100, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(i + 1) })), // nocturne sain
    })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(icrCalls().length).toBeGreaterThanOrEqual(1) // les nadirs repas déclenchent BIEN l'ICR (pas de pass vide)
    expect(isfCalls()).toHaveLength(0) // …mais PAS l'ISF (corrections propres)
    expect(basalCalls()).toHaveLength(0) // …ni la basale (nocturne sain)
  })
})

describe("proposalGeneratorService — dé-escalade basal/fixedDose (US-2653)", () => {
  beforeEach(() => vi.clearAllMocks())

  const NOCTURNAL = { id: "noct", rate: 0.8, startHour: 0, endHour: 6 }
  const pump = () => ({ configType: "pump", pumpSlots: [NOCTURNAL] })
  const nights = (fastingMgdl: number, nadirMgdl: number | null) =>
    Array.from({ length: 3 }, (_, i) => ({ fastingMgdl, nocturnalNadirMgdl: nadirMgdl, dayIso: isoDaysAgo(i + 1) }))
  const basalCalls = () =>
    createEngine.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((a) => a.parameterType === "basalRate")

  it("Somogyi : à jeun HAUT + hypo nocturne récurrente → FLAG nocturnalHypoHighFasting, JAMAIS de baisse directe", async () => {
    setup({ meals: [], basalConfig: pump(), fasting: nights(150, 60) }) // 1,50 à jeun, nadir 0,60 récurrent
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(basalCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "nocturnalHypoHighFasting", 99, undefined)
  })

  it("in-band + hypo nocturne récurrente → dé-escalade basale (baisse, basalTooHigh)", async () => {
    setup({ meals: [], basalConfig: pump(), fasting: nights(100, 60) }) // à jeun = cible 1,00, nadir 0,60
    await proposalGeneratorService.generateForPatient(1, 99)
    const basal = basalCalls()
    expect(basal).toHaveLength(1)
    expect(basal[0]).toMatchObject({ reason: "basalTooHigh", expectedCurrentValue: 0.8 })
    expect(Number(basal[0].proposedValue)).toBeLessThan(0.8)
    expect(raiseFlag).not.toHaveBeenCalled() // exclusivité : une dé-escalade OU un flag, jamais les deux
  })

  it("dé-escalade basale : cooldown < 72 h → sautée", async () => {
    setup({ meals: [], basalConfig: pump(), fasting: nights(100, 60) })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date() } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(basalCalls()).toHaveLength(0)
  })

  it("fix Q6b (basal) — dé-escalade bloquée par le cooldown MAIS hypo nocturne SÉVÈRE (0,50 g/L) → FLAG", async () => {
    // À jeun en cible mais nadir nocturne sévère récurrent, changement accepté à l'instant (cooldown actif) :
    // la baisse est bloquée mais une hypo nocturne sévère ne doit jamais être tue → surfaçage en flag.
    setup({ meals: [], basalConfig: pump(), fasting: nights(100, 50) })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date() } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(basalCalls()).toHaveLength(0) // dé-escalade bloquée (cooldown actif)
    expect(raiseFlag).toHaveBeenCalledWith(1, "nocturnalHypoHighFasting", 99, undefined) // sévérité nocturne surfacée
  })

  it("fixedDose : moyenne du moment > cible + hypos récurrentes → FLAG highVariabilityFixedDose", async () => {
    mode.mockResolvedValue({ mode: "fixedDose", coherent: true } as never)
    prismaMock.fixedDoseSlot.findMany.mockResolvedValue([{ moment: "morning", valueU: 10 }] as never)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT2", pregnancyMode: false } as never)
    prismaMock.glucoseTarget.findFirst.mockResolvedValue(null as never)
    // moyenne ~1,04 > cible 1,00, 2 relevés < 0,70 (récurrent) → flag.
    fixedDoseTrend.mockResolvedValue(toTroughs({ morning: [0.6, 0.6, 1.9], noon: [], evening: [], night: [] }) as never)
    createEngine.mockResolvedValue({ id: "e1" } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(createEngine.mock.calls.filter((c) => (c[0] as Record<string, unknown>).parameterType === "fixedDose")).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityFixedDose", 99, undefined)
  })

  it("basal : hypo nocturne sévère ISOLÉE (in-band, non récurrente) → FLAG, aucune dose", async () => {
    // 1 nadir sévère 0,50 + 2 sains ; à jeun = cible → in-band ; non récurrent.
    const fasting = [
      { fastingMgdl: 100, nocturnalNadirMgdl: 50, dayIso: isoDaysAgo(1) },
      { fastingMgdl: 100, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(2) },
      { fastingMgdl: 100, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(3) },
    ]
    setup({ meals: [], basalConfig: pump(), fasting })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(basalCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "nocturnalHypoHighFasting", 99, undefined)
  })

  it("basal : dé-escalade non actionnable (débit 0,10 trop bas) → FLAG, jamais de skip silencieux", async () => {
    setup({ meals: [], basalConfig: { configType: "pump", pumpSlots: [{ id: "noct", rate: 0.1, startHour: 0, endHour: 6 }] }, fasting: nights(100, 60) })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(basalCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "nocturnalHypoHighFasting", 99, undefined)
  })

  it("cooldown basal : requête filtre status=accepted + pumpBasalSlotId", async () => {
    setup({ meals: [], basalConfig: pump(), fasting: nights(100, 60) })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue(null as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(prismaMock.adjustmentProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "accepted", parameterType: "basalRate", pumpBasalSlotId: "noct" }) }),
    )
  })

  // ---- fixedDose (dé-escalade proposition / flag / cooldown) ----
  const fixedCalls = () =>
    createEngine.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((a) => a.parameterType === "fixedDose")
  const setupFixed = (slots: { moment: string; valueU: number }[], troughs: Record<string, number[]>) => {
    mode.mockResolvedValue({ mode: "fixedDose", coherent: true } as never)
    prismaMock.fixedDoseSlot.findMany.mockResolvedValue(slots as never)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT2", pregnancyMode: false } as never)
    prismaMock.glucoseTarget.findFirst.mockResolvedValue(null as never)
    fixedDoseTrend.mockResolvedValue(toTroughs({ morning: [], noon: [], evening: [], night: [], ...troughs }) as never)
    createEngine.mockResolvedValue({ id: "e1" } as never)
  }

  it("fixedDose : in-band + relevés récurremment bas → dé-escalade (baisse, fixedDoseTooHigh, 10 → 9)", async () => {
    // Moyenne EXACTEMENT à la cible (1,0) → deadband nul (isole la branche dé-escalade, pas la baisse deadband).
    setupFixed([{ moment: "morning", valueU: 10 }], { morning: [0.6, 0.6, 1.8] })
    await proposalGeneratorService.generateForPatient(1, 99)
    const fixed = fixedCalls()
    expect(fixed).toHaveLength(1)
    expect(fixed[0]).toMatchObject({ moment: "morning", reason: "fixedDoseTooHigh", proposedValue: 9 })
    expect(raiseFlag).not.toHaveBeenCalled() // exclusivité : une dé-escalade OU un flag, jamais les deux
  })

  it("fixedDose SOUS le plancher (0,3 U) + hypos récurrentes → FLAG (jamais silencieux — trou de surfaçage US-2653)", async () => {
    setupFixed([{ moment: "morning", valueU: 0.3 }], { morning: [0.6, 0.6, 0.9] })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(fixedCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityFixedDose", 99, undefined)
  })

  it("fixedDose : dé-escalade non actionnable (dose 1,0 U snappe à l'inchangé) → FLAG, pas de skip", async () => {
    setupFixed([{ moment: "morning", valueU: 1.0 }], { morning: [0.6, 0.6, 0.9] })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(fixedCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityFixedDose", 99, undefined)
  })

  it("fixedDose : hypo du moment sévère ISOLÉE (in-band, non récurrente) → FLAG, aucune dose", async () => {
    setupFixed([{ moment: "morning", valueU: 10 }], { morning: [0.5, 1.25, 1.25] }) // moyenne 1,0 = cible, 1 sévère isolé
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(fixedCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityFixedDose", 99, undefined)
  })

  it("cooldown fixedDose : dernier changement accepté < 72 h → dé-escalade sautée", async () => {
    setupFixed([{ moment: "morning", valueU: 10 }], { morning: [0.6, 0.6, 1.2, 1.3, 1.2] })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date() } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(fixedCalls()).toHaveLength(0)
  })

  it("fix Q6a (fixedDose) — délai écoulé (100 h) mais relevés PÉRIMÉS (avant le changement) → PAS de dé-escalade", async () => {
    // Moyenne à la cible (deadband nul) + relevés récurremment bas mais TOUS datés J-5..J-7 (< cutoff J-4) →
    // fenêtre post-changement vide → jamais re-titrer malgré le délai écoulé.
    mode.mockResolvedValue({ mode: "fixedDose", coherent: true } as never)
    prismaMock.fixedDoseSlot.findMany.mockResolvedValue([{ moment: "morning", valueU: 10 }] as never)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT2", pregnancyMode: false } as never)
    prismaMock.glucoseTarget.findFirst.mockResolvedValue(null as never)
    fixedDoseTrend.mockResolvedValue(toTroughs({ morning: [0.6, 0.6, 1.8], noon: [], evening: [], night: [] }, [isoDaysAgo(5), isoDaysAgo(6), isoDaysAgo(7)]) as never)
    createEngine.mockResolvedValue({ id: "e1" } as never)
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date(Date.now() - 100 * 3_600_000) } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(fixedCalls()).toHaveLength(0) // délai écoulé mais aucun relevé post-changement
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "highVariabilityFixedDose", 99, undefined) // 0,60 non sévère
  })

  it("fix Q6b (fixedDose) — dé-escalade bloquée par le cooldown MAIS relevé SÉVÈRE (0,50 g/L) → FLAG", async () => {
    // Moyenne à la cible (deadband nul), relevés récurrents dont un sévère, changement à l'instant (cooldown actif).
    setupFixed([{ moment: "morning", valueU: 10 }], { morning: [0.5, 0.5, 2.0] })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date() } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(fixedCalls()).toHaveLength(0) // dé-escalade bloquée (cooldown actif)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityFixedDose", 99, undefined) // sévérité surfacée (Q6b)
  })

  it("cooldown ICR : dé-escalade ICR sautée si dernier changement accepté < 72 h", async () => {
    const inBandHypoMeals = Array.from({ length: 3 }, () => meal({ postMgdl: 150, nadirMgdl: 60, localHour: 13 }))
    const icrCalls = () =>
      createEngine.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((a) => a.parameterType === "insulinToCarbRatio")
    setup({ meals: inBandHypoMeals })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date() } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(icrCalls()).toHaveLength(0)
  })

  const icrCalls = () =>
    createEngine.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((a) => a.parameterType === "insulinToCarbRatio")

  it("fix Q6b (ICR) — hypo post-repas sévère ISOLÉE (in-band, non récurrente) → FLAG (parité ISF/basal/fixedDose)", async () => {
    // 1 nadir sévère 0,50 + 2 sains ; PPG 1,40 dans la bande ; non récurrent. Sans le fix, l'ICR taisait ce
    // danger (seul levier sans branche « sévère isolé ») → régression de sécurité corrigée.
    setup({ meals: [
      meal({ postMgdl: 140, nadirMgdl: 50, localHour: 13 }),
      meal({ postMgdl: 140, nadirMgdl: 160, localHour: 13 }),
      meal({ postMgdl: 140, nadirMgdl: 160, localHour: 13 }),
    ] })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(icrCalls()).toHaveLength(0)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityPostMeal", 99, undefined)
  })

  it("fix Q6b (ICR) — dé-escalade bloquée par le cooldown MAIS nadir SÉVÈRE récurrent → FLAG", async () => {
    setup({ meals: Array.from({ length: 3 }, () => meal({ postMgdl: 140, nadirMgdl: 50, localHour: 13 })) })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date() } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(icrCalls()).toHaveLength(0) // dé-escalade bloquée (cooldown actif)
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityPostMeal", 99, undefined) // sévérité surfacée
  })

  it("fix Q6a (ICR) — délai écoulé (100 h) mais hypos PÉRIMÉES (avant le changement) → PAS de dé-escalade", async () => {
    const stale = Array.from({ length: 3 }, (_, i) => meal({ postMgdl: 140, nadirMgdl: 60, localHour: 13, dayIso: isoDaysAgo(i + 5) }))
    setup({ meals: stale })
    prismaMock.adjustmentProposal.findFirst.mockResolvedValue({ reviewedAt: new Date(Date.now() - 100 * 3_600_000) } as never)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(icrCalls()).toHaveLength(0) // délai écoulé mais aucune observation post-changement → jamais de dose
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "highVariabilityPostMeal", 99, undefined) // nadir 0,60 non sévère
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
    // observance : par défaut `createdAt` = maintenant → garde enrollment (< 30 j) neutralise le flag
    // pour les tests des AUTRES flags. Les tests observance passent un createdAt ancien + les comptes.
    monitoring: { createdAt?: Date; cgmCount?: number; bgmCount?: number } = {},
  ) {
    const v = hba1c.value ?? 6 // valeur HbA1c par défaut (< 8 → pas de flag aboveTarget)
    mode.mockResolvedValue({ mode: "nonInsulin", coherent: true } as never)
    prismaMock.glycemiaEntry.findFirst.mockResolvedValue(hba1c.gly ? ({ date: hba1c.gly, hba1c: v } as never) : null)
    prismaMock.diabetesEvent.findFirst.mockResolvedValue(hba1c.evt ? ({ eventDate: hba1c.evt, hba1c: v } as never) : null)
    prismaMock.patient.findFirst.mockResolvedValue({
      pathology: patient.pathology ?? "DT2", pregnancyMode: patient.pregnancyMode ?? false,
      createdAt: monitoring.createdAt ?? new Date(),
    } as never)
    prismaMock.annexObjective.findUnique.mockResolvedValue(objectiveHba1c !== null ? ({ objectiveHba1c } as never) : null)
    prismaMock.cgmEntry.count.mockResolvedValue((monitoring.cgmCount ?? 0) as never)
    prismaMock.glycemiaEntry.count.mockResolvedValue((monitoring.bgmCount ?? 0) as never)
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
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT2", pregnancyMode: false, createdAt: new Date() } as never)
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

  // ── observance (US-2651, validé medical) : either/or CGM-capture / comptage BGM + garde enrollment ──
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

  it("observance : les DEUX canaux échouent (pas de CGM, 2 BGM, DT2, inscrit 60 j) → flag levé", async () => {
    setupNonInsulin({ evt: new Date() }, null, {}, null, { createdAt: daysAgo(60), cgmCount: 0, bgmCount: 2 })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).toHaveBeenCalledWith(1, "observance", 99, undefined)
  })

  it("observance : testeur BGM diligent (5 ≥ 4, DT2) → PAS de flag", async () => {
    setupNonInsulin({ evt: new Date() }, null, {}, null, { createdAt: daysAgo(60), cgmCount: 0, bgmCount: 5 })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "observance", 99, undefined)
  })

  it("observance : porteur CGM régulier (capture ≥ 30 %) → PAS de flag (jamais faussement flagué)", async () => {
    setupNonInsulin({ evt: new Date() }, null, {}, null, { createdAt: daysAgo(60), cgmCount: 3000, bgmCount: 0 })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "observance", 99, undefined)
  })

  it("observance : garde enrollment — patient inscrit depuis 10 j (< 30) → PAS de flag même si tout échoue", async () => {
    setupNonInsulin({ evt: new Date() }, null, {}, null, { createdAt: daysAgo(10), cgmCount: 0, bgmCount: 0 })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "observance", 99, undefined)
  })

  it("observance : seuil pathology-aware — GD avec 10 BGM (< 30) → flag ; un DT2 avec 10 (≥ 4) → non", async () => {
    setupNonInsulin({ evt: new Date() }, null, { pathology: "GD" }, null, { createdAt: daysAgo(60), cgmCount: 0, bgmCount: 10 })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).toHaveBeenCalledWith(1, "observance", 99, undefined) // GD exige ≥ 30
    raiseFlag.mockClear()
    setupNonInsulin({ evt: new Date() }, null, { pathology: "DT2" }, null, { createdAt: daysAgo(60), cgmCount: 0, bgmCount: 10 })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(raiseFlag).not.toHaveBeenCalledWith(1, "observance", 99, undefined) // DT2 : 10 ≥ 4 → observant
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

  it("un patient fixedDose sans dose ne gonfle PAS errored (skipped noFixedDose proprement)", async () => {
    setup({ mode: "fixedDose" })
    prismaMock.fixedDoseSlot.findMany.mockResolvedValue([] as never) // aucune dose → EMPTY(noFixedDose), pas d'erreur
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

describe("US-2658 — fenêtre d'analyse à la demande (windowDays)", () => {
  beforeEach(() => vi.clearAllMocks())
  const fixedDoseTrend = vi.mocked(analyticsService.fixedDoseTrend)
  const basalCfg = { configType: "pump", pumpSlots: [{ id: "p1", rate: 0.8, startHour: 0, endHour: 6 }] }

  it("windowDays applique `${windowDays}d` à ICR/basal, l'ISF garde 30 j", async () => {
    setup({
      basalConfig: basalCfg,
      glucoseTargets: [{ targetGlucose: 120 }],
      fasting: [{ fastingMgdl: 110, nocturnalNadirMgdl: 100 }],
      sensitivityFactors: [{ startHour: 0, endHour: 24, sensitivityFactorGl: 0.5 }],
      corrections: [],
    })
    await proposalGeneratorService.generateForPatient(1, 99, undefined, 4)

    expect(dailyJournal.mock.calls[0]?.[1]).toBe("4d") // ICR → fenêtre choisie
    expect(fastingTrend.mock.calls[0]?.[1]).toBe("4d") // basal → fenêtre choisie
    expect(correctionTrend.mock.calls[0]?.[1]).toBe("30d") // ISF → 30 j inchangé (décision §3)
  })

  it("sans windowDays (cron) → 14 j par défaut (comportement inchangé)", async () => {
    setup({ basalConfig: basalCfg, glucoseTargets: [{ targetGlucose: 120 }], fasting: [{ fastingMgdl: 110, nocturnalNadirMgdl: 100 }] })
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(dailyJournal.mock.calls[0]?.[1]).toBe("14d")
    expect(fastingTrend.mock.calls[0]?.[1]).toBe("14d")
  })

  it("mode fixedDose : windowDays applique `${windowDays}d` aux creux pré-dose", async () => {
    mode.mockResolvedValue({ mode: "fixedDose", coherent: true } as never)
    prismaMock.fixedDoseSlot.findMany.mockResolvedValue([{ moment: "morning", valueU: 10 }] as never)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT2", pregnancyMode: false } as never)
    prismaMock.glucoseTarget.findFirst.mockResolvedValue(null as never)
    fixedDoseTrend.mockResolvedValue({} as never)
    createEngine.mockResolvedValue({ id: "e1" } as never)

    await proposalGeneratorService.generateForPatient(1, 99, undefined, 3)
    expect(fixedDoseTrend.mock.calls[0]?.[1]).toBe("3d")
  })
})
