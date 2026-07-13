/**
 * Tests — US-2663 (S3b-1) : bascule du générateur moteur vers l'ÉMISSION GROUPÉE ISF/ICR
 * (`proposalGeneratorService.generateForPatient`, derrière le flag `ENGINE_GROUPED_ISF_ICR`).
 *
 * Sécurité clinique testée :
 *  - flag OFF (défaut) → comportement par-valeur INCHANGÉ (`createEngineProposal`, jamais de groupé) ;
 *  - flag ON → **une** `SlotSetProposal` `source: "algorithm"` par levier, disposition ENTIÈRE assemblée
 *    depuis la config LIVE, valeurs changées superposées ;
 *  - R2 — CAS par créneau CHANGÉ : un créneau dont la base a DÉRIVÉ depuis l'analyse est ABANDONNÉ
 *    (jamais une magnitude périmée dans la disposition) ;
 *  - R4 — no-op : aucune proposition émise si aucun créneau ne change (0 candidat OU tous dérivés) ;
 *  - R5 — `mealLabel` ICR préservé sur la disposition ;
 *  - R3 — rationale MOTEUR : une entrée par créneau changé (motif/confiance/volume/moyenne/période) ;
 *  - un rejet fail-closed de `createSetProposal` reste NON FATAL (run continue, `created = 0`).
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
  localDay: (ms: number) => new Date(ms).toISOString().slice(0, 10),
}))
vi.mock("@/lib/services/adjustment.service", () => ({
  adjustmentService: { createEngineProposal: vi.fn() },
}))
vi.mock("@/lib/services/analytics.service", () => ({
  analyticsService: { fixedDoseTrend: vi.fn() },
}))
vi.mock("@/lib/db/cron-lock", () => ({
  withSessionAdvisoryLock: vi.fn((_key: string, fn: () => Promise<unknown>) => fn()),
}))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("@/lib/services/clinical-review-flag.service", () => ({
  clinicalReviewFlagService: { raise: vi.fn().mockResolvedValue({ flagId: "f1", created: true }) },
}))
// US-2663 (S3b-1) — voie GROUPÉE moteur : on mocke le service d'ensemble pour capturer la disposition émise.
vi.mock("@/lib/services/slot-set-proposal.service", () => ({
  slotSetProposalService: { createSetProposal: vi.fn() },
}))

import { proposalGeneratorService } from "@/lib/services/proposal-generator.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { mealtimePattern } from "@/lib/services/meal-trends.service"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { clinicalReviewFlagService } from "@/lib/services/clinical-review-flag.service"
import { slotSetProposalService } from "@/lib/services/slot-set-proposal.service"

const mode = vi.mocked(treatmentModeService.resolveTreatmentMode)
const getSettings = vi.mocked(insulinTherapyService.getSettings)
const dailyJournal = vi.mocked(mealtimePattern.dailyJournal)
const correctionTrend = vi.mocked(mealtimePattern.correctionTrend)
const createEngine = vi.mocked(adjustmentService.createEngineProposal)
const raiseFlag = vi.mocked(clinicalReviewFlagService.raise)
const createSet = vi.mocked(slotSetProposalService.createSetProposal)

const DAY_MS = 86_400_000
const isoDaysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10)

/** Repas ICR exploitable (glucides/bolus OK, pré-repas 1,0 g/L en bande). `localHour` = midi par défaut. */
function meal(over: Partial<Record<string, unknown>> = {}) {
  return {
    mealId: "m", dayIso: isoDaysAgo(1), localHour: 13, moment: "noon",
    preMgdl: 100, postMgdl: 200, nadirMgdl: 160, carbs: 45, bolus: 6, ...over,
  } as never
}

/** Corrections ISF propres appariées (au-dessus/à la cible selon `post`). */
const corrections = (post: number, nadir: number | null, localHour = 9, n = 4) =>
  Array.from({ length: n }, (_, i) => ({ localHour, dayIso: isoDaysAgo(i), postGlucoseGl: post, targetGl: 1.2, nadirGl: nadir }))

/**
 * Configure les mocks pour un run `basalBolus`. `liveCarbRatios` / `liveIsf` alimentent la RELECTURE LIVE
 * de `emitGroupedIsfIcr` (distincte de `getSettings` → permet de simuler une dérive de base R2).
 */
function setup(opts: {
  carbRatios?: { startHour: number; endHour: number; gramsPerUnit: number }[]
  meals?: unknown[]
  sensitivityFactors?: { startHour: number; endHour: number; sensitivityFactorGl: number }[]
  corrections?: { localHour: number; postGlucoseGl: number; targetGl: number; nadirGl: number | null }[]
  liveCarbRatios?: { startHour: number; endHour: number; gramsPerUnit: number; mealLabel?: string | null }[]
  liveIsf?: { startHour: number; endHour: number; sensitivityFactorGl: number }[]
} = {}) {
  mode.mockResolvedValue({ mode: "basalBolus", coherent: true } as never)
  getSettings.mockResolvedValue({
    carbRatios: opts.carbRatios ?? [{ startHour: 12, endHour: 14, gramsPerUnit: 10 }],
    sensitivityFactors: opts.sensitivityFactors ?? [],
    basalConfiguration: null,
    glucoseTargets: [],
    basalInsulin: undefined,
  } as never)
  prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1", pregnancyMode: false } as never)
  dailyJournal.mockResolvedValue((opts.meals ?? [meal(), meal(), meal()]) as never)
  correctionTrend.mockResolvedValue((opts.corrections ?? []) as never)
  createEngine.mockResolvedValue({ id: "e1" } as never)
  createSet.mockResolvedValue({ id: "s1" } as never)
  // Relecture LIVE (T1) — par défaut = miroir de `getSettings` (pas de dérive), avec un mealLabel ICR.
  prismaMock.carbRatio.findMany.mockResolvedValue(
    (opts.liveCarbRatios ?? [{ startHour: 12, endHour: 14, gramsPerUnit: 10, mealLabel: "Déjeuner" }]) as never,
  )
  prismaMock.insulinSensitivityFactor.findMany.mockResolvedValue((opts.liveIsf ?? []) as never)
}

/** Extrait le dernier appel `createSetProposal` pour un levier donné. */
function setCallFor(param: "insulinToCarbRatio" | "insulinSensitivityFactor") {
  const call = createSet.mock.calls.find((c) => c[1] === param)
  return call
    ? { patientId: call[0], parameterType: call[1], disposition: call[2], proposer: call[3], rationale: call[5] }
    : undefined
}

describe("proposalGeneratorService — émission GROUPÉE (US-2663 S3b-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ENGINE_GROUPED_ISF_ICR = "true"
  })
  afterEach(() => {
    delete process.env.ENGINE_GROUPED_ISF_ICR
  })

  it("flag ON — ICR : émet UNE SlotSetProposal source=algorithm (jamais de par-valeur)", async () => {
    setup() // PPG 2,0 g/L > plafond DT1 1,80 → baisse ICR sur le créneau [12,14]
    const res = await proposalGeneratorService.generateForPatient(1, 99)

    expect(createEngine).not.toHaveBeenCalled() // plus de voie par-valeur en mode groupé
    const call = setCallFor("insulinToCarbRatio")!
    expect(call).toBeDefined()
    expect(call.patientId).toBe(1)
    expect(call.proposer).toEqual({ userId: null, source: "algorithm" })
    // Disposition ENTIÈRE (ici 1 créneau), valeur baissée + mealLabel PRÉSERVÉ (R5).
    const disposition = call.disposition as { startHour: number; endHour: number; value: number; mealLabel?: string }[]
    expect(disposition).toHaveLength(1)
    expect(disposition[0]).toMatchObject({ startHour: 12, endHour: 14, mealLabel: "Déjeuner" })
    expect(disposition[0].value).toBeLessThan(10) // baisse ICR
    // Rationale par créneau changé (R3) : motif + période (jours entiers).
    const rationale = call.rationale as { startHour: number; reason: string; analysisPeriod: number }[]
    expect(rationale).toHaveLength(1)
    expect(rationale[0]).toMatchObject({ startHour: 12, reason: "icrTooHigh", analysisPeriod: 14 })
    expect(res.created).toBe(1)
  })

  it("flag ON — disposition multi-créneaux : seul le créneau changé est superposé, l'autre garde sa valeur live", async () => {
    // Créneau matin [6,12] PPG 2,0 → baisse ; créneau midi [12,18] PPG 1,5 in-band → inchangé.
    setup({
      carbRatios: [{ startHour: 6, endHour: 12, gramsPerUnit: 10 }, { startHour: 12, endHour: 18, gramsPerUnit: 8 }],
      meals: [
        meal({ localHour: 9, moment: "morning", postMgdl: 200 }), meal({ localHour: 9, moment: "morning", postMgdl: 200 }), meal({ localHour: 9, moment: "morning", postMgdl: 200 }),
        meal({ localHour: 14, moment: "noon", postMgdl: 150 }), meal({ localHour: 14, moment: "noon", postMgdl: 150 }), meal({ localHour: 14, moment: "noon", postMgdl: 150 }),
      ],
      liveCarbRatios: [
        { startHour: 6, endHour: 12, gramsPerUnit: 10, mealLabel: "Petit-déjeuner" },
        { startHour: 12, endHour: 18, gramsPerUnit: 8, mealLabel: "Déjeuner" },
      ],
    })
    await proposalGeneratorService.generateForPatient(1, 99)

    const call = setCallFor("insulinToCarbRatio")!
    const disposition = call.disposition as { startHour: number; value: number; mealLabel?: string }[]
    expect(disposition).toHaveLength(2)
    const morning = disposition.find((s) => s.startHour === 6)!
    const noon = disposition.find((s) => s.startHour === 12)!
    expect(morning.value).toBeLessThan(10) // changé (baisse)
    expect(noon.value).toBe(8) // inchangé → valeur live conservée
    // Rationale UNIQUEMENT pour le créneau changé.
    const rationale = call.rationale as { startHour: number }[]
    expect(rationale).toHaveLength(1)
    expect(rationale[0].startHour).toBe(6)
  })

  it("R2 — dérive de base : la valeur live diffère de la base analysée → créneau abandonné, no-op (aucune émission)", async () => {
    // Analyse sur gramsPerUnit 10 (getSettings) → candidat ; mais la config a dérivé à 12 avant l'émission.
    setup({ liveCarbRatios: [{ startHour: 12, endHour: 14, gramsPerUnit: 12, mealLabel: "Déjeuner" }] })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet).not.toHaveBeenCalled() // magnitude périmée jamais injectée
    expect(res.created).toBe(0)
  })

  it("R4 — no-op : PPG en bande (aucun candidat) → aucune SlotSetProposal", async () => {
    setup({ meals: [meal({ postMgdl: 150 }), meal({ postMgdl: 150 }), meal({ postMgdl: 150 })] }) // 1,5 g/L in-band
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet).not.toHaveBeenCalled()
    expect(res.created).toBe(0)
  })

  it("flag ON — ISF : émet une SlotSetProposal ISF (période 30 j), rationale isfTooHigh", async () => {
    const ISF_SLOT = { startHour: 8, endHour: 12, sensitivityFactorGl: 0.5 }
    setup({
      meals: [],
      sensitivityFactors: [ISF_SLOT],
      corrections: corrections(1.8, 1.4), // au-dessus cible → baisse ISF (isfTooHigh)
      liveIsf: [ISF_SLOT],
    })
    await proposalGeneratorService.generateForPatient(1, 99)

    expect(createEngine).not.toHaveBeenCalled()
    const call = setCallFor("insulinSensitivityFactor")!
    expect(call).toBeDefined()
    expect(call.proposer).toEqual({ userId: null, source: "algorithm" })
    const disposition = call.disposition as { startHour: number; value: number }[]
    expect(disposition).toHaveLength(1)
    expect(disposition[0].value).toBeLessThan(0.5) // baisse ISF
    const rationale = call.rationale as { startHour: number; reason: string; analysisPeriod: number }[]
    expect(rationale[0]).toMatchObject({ startHour: 8, reason: "isfTooHigh", analysisPeriod: 30 })
  })

  it("un rejet fail-closed de createSetProposal reste NON FATAL (run continue, created = 0)", async () => {
    setup()
    createSet.mockRejectedValue(new Error("duplicatePendingProposal"))
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.created).toBe(0) // rejet attendu absorbé
    expect(res.slotsConsidered).toBe(1) // le créneau a bien été analysé
  })

  it("flag OFF (défaut) — voie par-valeur INCHANGÉE (createEngineProposal, aucune groupée)", async () => {
    delete process.env.ENGINE_GROUPED_ISF_ICR
    setup()
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet).not.toHaveBeenCalled()
    expect(createEngine).toHaveBeenCalledTimes(1)
    expect(createEngine.mock.calls[0]![0]).toMatchObject({ parameterType: "insulinToCarbRatio", reason: "icrTooHigh" })
    expect(res.created).toBe(1)
  })

  it("flag ON — ICR + ISF simultanés : DEUX propositions groupées (une par levier), toujours 0 par-valeur", async () => {
    const ISF_SLOT = { startHour: 8, endHour: 12, sensitivityFactorGl: 0.5 }
    setup({
      sensitivityFactors: [ISF_SLOT],
      corrections: corrections(1.8, 1.4),
      liveIsf: [ISF_SLOT],
    }) // ICR baisse (meals défaut PPG 2,0) + ISF baisse
    const res = await proposalGeneratorService.generateForPatient(1, 99)

    expect(createEngine).not.toHaveBeenCalled()
    expect(setCallFor("insulinToCarbRatio")).toBeDefined()
    expect(setCallFor("insulinSensitivityFactor")).toBeDefined()
    expect(createSet).toHaveBeenCalledTimes(2)
    expect(res.created).toBe(2)
    expect(raiseFlag).not.toHaveBeenCalled()
  })
})
