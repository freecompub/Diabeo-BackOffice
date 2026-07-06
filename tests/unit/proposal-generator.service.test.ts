/**
 * Tests — US-2651 générateur ICR (`proposalGeneratorService.generateForPatient`).
 *
 * Sécurité clinique testée : routage par mode (basalBolus seul), deadband post-prandial asymétrique
 * (plafond/borne basse), resserrement grossesse, portes qualité (glucides/bolus/pré-repas), bucketing
 * à l'heure réelle, et non-fatalité des rejets fail-closed de `createEngineProposal`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/treatment-mode.service", () => ({
  treatmentModeService: { resolveTreatmentMode: vi.fn() },
}))
vi.mock("@/lib/services/insulin-therapy.service", () => ({
  insulinTherapyService: { getSettings: vi.fn() },
}))
vi.mock("@/lib/services/meal-trends.service", () => ({
  mealtimePattern: { dailyJournal: vi.fn() },
}))
vi.mock("@/lib/services/adjustment.service", () => ({
  adjustmentService: { createEngineProposal: vi.fn() },
}))

import { proposalGeneratorService } from "@/lib/services/proposal-generator.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { mealtimePattern } from "@/lib/services/meal-trends.service"
import { adjustmentService } from "@/lib/services/adjustment.service"

const mode = vi.mocked(treatmentModeService.resolveTreatmentMode)
const getSettings = vi.mocked(insulinTherapyService.getSettings)
const dailyJournal = vi.mocked(mealtimePattern.dailyJournal)
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
} = {}) {
  mode.mockResolvedValue({ mode: opts.mode ?? "basalBolus", coherent: true } as never)
  getSettings.mockResolvedValue({
    carbRatios: opts.carbRatios ?? [{ startHour: 12, endHour: 14, gramsPerUnit: 10 }],
  } as never)
  prismaMock.patient.findFirst.mockResolvedValue({
    pathology: opts.pathology ?? "DT1", pregnancyMode: opts.pregnancyMode ?? false,
  } as never)
  dailyJournal.mockResolvedValue((opts.meals ?? [meal(), meal(), meal()]) as never)
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
