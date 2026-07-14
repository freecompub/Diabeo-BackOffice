/**
 * Tests — US-2663 (S5) : le générateur moteur émet des propositions GROUPÉES
 * (`proposalGeneratorService.generateForPatient`).
 *
 * Depuis S5, l'émission GROUPÉE est le comportement PAR DÉFAUT et UNIQUE : la voie
 * par-valeur `createEngineProposal` a été RETIRÉE du service (plus aucun flag
 * `ENGINE_GROUPED_*` — le groupé n'est plus conditionnel).
 *
 * Sécurité clinique testée :
 *  - **une** `SlotSetProposal` `source: "algorithm"` par levier, disposition ENTIÈRE
 *    assemblée depuis la config LIVE, valeurs changées superposées ;
 *  - R2 — CAS par créneau CHANGÉ : un créneau dont la base a DÉRIVÉ depuis l'analyse est ABANDONNÉ
 *    (jamais une magnitude périmée dans la disposition) ;
 *  - R4 — no-op : aucune proposition émise si aucun créneau ne change (0 candidat OU tous dérivés) ;
 *  - R5 — `mealLabel` ICR préservé sur la disposition ;
 *  - R3 — rationale MOTEUR : une entrée par créneau changé (motif/confiance/volume/moyenne/période) ;
 *  - un rejet fail-closed de `createSetProposal` reste NON FATAL (run continue, `created = 0`).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/treatment-mode.service", () => ({
  treatmentModeService: { resolveTreatmentMode: vi.fn() },
}))
vi.mock("@/lib/services/insulin-therapy.service", () => ({
  // S3d PR2 — `getFixedDoseSlots` : relecture live de la dose fixe (emitGroupedFixedDose).
  // S3e PR2 — `getStyloBasalSlots` : relecture live de la dose stylo (emitGroupedStyloBasal).
  insulinTherapyService: { getSettings: vi.fn(), getFixedDoseSlots: vi.fn(), getStyloBasalSlots: vi.fn() },
}))
vi.mock("@/lib/services/meal-trends.service", () => ({
  mealtimePattern: { dailyJournal: vi.fn(), fastingTrend: vi.fn(), correctionTrend: vi.fn() },
  localDay: (ms: number) => new Date(ms).toISOString().slice(0, 10),
}))
vi.mock("@/lib/services/adjustment.service", async (importOriginal) => {
  // US-2663 (S3b-1) — le générateur importe la garde pure `reasonImpliesIncrease` (parité `reasonDirectionMismatch`).
  // On récupère la VRAIE fonction (pas de réimplémentation → aucun drift possible si un suffixe directionnel évolue).
  // La voie par-valeur (`createEngineProposal`) a été RETIRÉE (S5) : persistance moteur = `createSetProposal` uniquement.
  const actual = await importOriginal<typeof import("@/lib/services/adjustment.service")>()
  return actual
})
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

import { proposalGeneratorService, assembleGroupedDisposition, assembleGroupedPumpDisposition, assembleGroupedFixedDose, assembleGroupedStyloDisposition } from "@/lib/services/proposal-generator.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { mealtimePattern } from "@/lib/services/meal-trends.service"
import { analyticsService } from "@/lib/services/analytics.service"
import { clinicalReviewFlagService } from "@/lib/services/clinical-review-flag.service"
import { slotSetProposalService } from "@/lib/services/slot-set-proposal.service"

const mode = vi.mocked(treatmentModeService.resolveTreatmentMode)
const getSettings = vi.mocked(insulinTherapyService.getSettings)
const dailyJournal = vi.mocked(mealtimePattern.dailyJournal)
const correctionTrend = vi.mocked(mealtimePattern.correctionTrend)
const fastingTrend = vi.mocked(mealtimePattern.fastingTrend)
const raiseFlag = vi.mocked(clinicalReviewFlagService.raise)
const createSet = vi.mocked(slotSetProposalService.createSetProposal)
const getFixedDoseSlots = vi.mocked(insulinTherapyService.getFixedDoseSlots)
const getStyloBasalSlots = vi.mocked(insulinTherapyService.getStyloBasalSlots)
const fixedDoseTrend = vi.mocked(analyticsService.fixedDoseTrend)

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
  createSet.mockResolvedValue({ id: "s1" } as never)
  // Relecture LIVE (T1) — par défaut = miroir de `getSettings` (pas de dérive), avec un mealLabel ICR.
  prismaMock.carbRatio.findMany.mockResolvedValue(
    (opts.liveCarbRatios ?? [{ startHour: 12, endHour: 14, gramsPerUnit: 10, mealLabel: "Déjeuner" }]) as never,
  )
  prismaMock.insulinSensitivityFactor.findMany.mockResolvedValue((opts.liveIsf ?? []) as never)
}

/** Extrait le dernier appel `createSetProposal` pour un levier donné (signature objet d'options S3c). */
function setCallFor(param: "insulinToCarbRatio" | "insulinSensitivityFactor") {
  const call = createSet.mock.calls.find((c) => c[0]?.parameterType === param)
  const inp = call?.[0]
  return inp
    ? { patientId: inp.patientId, parameterType: inp.parameterType, disposition: inp.proposedSlots, proposer: inp.proposer, rationale: inp.rationale, baseline: inp.baselineOverride }
    : undefined
}

describe("proposalGeneratorService — émission GROUPÉE (US-2663 S3b-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ICR : émet UNE SlotSetProposal source=algorithm (jamais de par-valeur)", async () => {
    setup() // PPG 2,0 g/L > plafond DT1 1,80 → baisse ICR sur le créneau [12,14]
    const res = await proposalGeneratorService.generateForPatient(1, 99)

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

  it("disposition multi-créneaux : seul le créneau changé est superposé, l'autre garde sa valeur live", async () => {
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

  it("ISF : émet une SlotSetProposal ISF (période 30 j), rationale isfTooHigh", async () => {
    const ISF_SLOT = { startHour: 8, endHour: 12, sensitivityFactorGl: 0.5 }
    setup({
      meals: [],
      sensitivityFactors: [ISF_SLOT],
      corrections: corrections(1.8, 1.4), // au-dessus cible → baisse ISF (isfTooHigh)
      liveIsf: [ISF_SLOT],
    })
    await proposalGeneratorService.generateForPatient(1, 99)

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

  it("US-2663 (S5) — GROUPED-ONLY : émet une proposition groupée (voie par-valeur retirée)", async () => {
    setup()
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(setCallFor("insulinToCarbRatio")).toBeDefined()
    expect(res.created).toBe(1)
  })

  it("ICR + ISF simultanés : DEUX propositions groupées (une par levier), toujours 0 par-valeur", async () => {
    const ISF_SLOT = { startHour: 8, endHour: 12, sensitivityFactorGl: 0.5 }
    setup({
      sensitivityFactors: [ISF_SLOT],
      corrections: corrections(1.8, 1.4),
      liveIsf: [ISF_SLOT],
    }) // ICR baisse (meals défaut PPG 2,0) + ISF baisse
    const res = await proposalGeneratorService.generateForPatient(1, 99)

    expect(setCallFor("insulinToCarbRatio")).toBeDefined()
    expect(setCallFor("insulinSensitivityFactor")).toBeDefined()
    expect(createSet).toHaveBeenCalledTimes(2)
    expect(res.created).toBe(2)
    expect(raiseFlag).not.toHaveBeenCalled()
  })

  it("fenêtre TOCTOU fermée : le baseline injecté = la lecture LIVE (mêmes créneaux que la disposition)", async () => {
    setup() // 1 créneau [12,14] gramsPerUnit 10, mealLabel "Déjeuner"
    await proposalGeneratorService.generateForPatient(1, 99)
    const call = setCallFor("insulinToCarbRatio")!
    // 7ᵉ arg = baseline injecté : reflète la config LIVE (valeur NON overlayée, mealLabel préservé) — c'est la
    // MÊME lecture que la base de la disposition (fenêtre TOCTOU fermée : le CAS d'acceptation couvre tous les créneaux).
    expect(call.baseline).toEqual([{ startHour: 12, endHour: 14, value: 10, mealLabel: "Déjeuner" }])
    // La disposition partage le même créneau, seule `value` diffère (baissée).
    const disposition = call.disposition as { startHour: number; value: number }[]
    expect(disposition[0].startHour).toBe(12)
    expect(disposition[0].value).toBeLessThan(10)
  })

  it("R2 — dérive de endHour : même startHour mais fenêtre horaire déplacée → créneau abandonné (no-op)", async () => {
    // Analyse sur [12,14] ; la config a été restructurée en [12,16] avant l'émission → fenêtre du signal périmée.
    setup({ liveCarbRatios: [{ startHour: 12, endHour: 16, gramsPerUnit: 10, mealLabel: "Déjeuner" }] })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet).not.toHaveBeenCalled()
    expect(res.created).toBe(0)
  })

  it("créneau candidat absent de la config live (startHour disparu) → abandonné (no-op)", async () => {
    // Candidat sur [12,14] ; la config live ne porte plus qu'un créneau [6,10] → aucun overlay applicable.
    setup({ liveCarbRatios: [{ startHour: 6, endHour: 10, gramsPerUnit: 9, mealLabel: "Petit-déjeuner" }] })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet).not.toHaveBeenCalled()
    expect(res.created).toBe(0)
  })

  it("config live vidée entre analyse et émission → aucune SlotSetProposal", async () => {
    setup({ liveCarbRatios: [] })
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet).not.toHaveBeenCalled()
    expect(res.created).toBe(0)
  })

  it("rejet fail-closed de createSetProposal sur la voie ISF reste NON FATAL", async () => {
    const ISF_SLOT = { startHour: 8, endHour: 12, sensitivityFactorGl: 0.5 }
    setup({ meals: [], sensitivityFactors: [ISF_SLOT], corrections: corrections(1.8, 1.4), liveIsf: [ISF_SLOT] })
    createSet.mockRejectedValue(new Error("valueOutOfBounds"))
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(res.created).toBe(0) // rejet ISF absorbé, pas de throw
  })
})

describe("assembleGroupedDisposition (US-2663 S3b-1, cœur pur)", () => {
  // US-2663 (S5) — `bounds` est désormais REQUIS sur les assembleurs purs. Valeurs live ICR ⊂ [3,30] → no-op.
  const ICR = { min: 3, max: 30 }
  const live = [
    { startHour: 6, endHour: 12, value: 10, mealLabel: "Petit-déjeuner" },
    { startHour: 12, endHour: 18, value: 8 },
  ]
  const cand = (over: Partial<{ startHour: number; endHour: number; currentValue: number; proposedValue: number; reason: string }> = {}) => ({
    startHour: over.startHour ?? 6,
    endHour: over.endHour ?? 12,
    cand: {
      parameterType: "insulinToCarbRatio",
      reason: over.reason ?? "icrTooHigh",
      currentValue: over.currentValue ?? 10,
      proposedValue: over.proposedValue ?? 9, // baisse cohérente avec icrTooHigh
      changePercent: -10,
      confidence: "high",
      supportingEvents: 8,
      totalEventsConsidered: 8,
    },
  }) as never

  it("créneau changé cohérent → superposé, autres inchangés, rationale 1 entrée, mealLabel préservé (R5)", () => {
    const res = assembleGroupedDisposition(live, [cand()], 14, ICR)!
    expect(res.disposition).toEqual([
      { startHour: 6, endHour: 12, value: 9, mealLabel: "Petit-déjeuner" }, // changé
      { startHour: 12, endHour: 18, value: 8 }, // inchangé
    ])
    expect(res.rationale).toHaveLength(1)
    expect(res.rationale[0]).toMatchObject({ startHour: 6, reason: "icrTooHigh", analysisPeriod: 14 })
    expect(res.directionMismatches).toBe(0)
  })

  it("garde direction : reason icrTooLow (hausse attendue) mais BAISSE proposée → abandonné + comptabilisé", () => {
    const res = assembleGroupedDisposition(live, [cand({ reason: "icrTooLow", proposedValue: 9 })], 14, ICR)
    expect(res.disposition).toBeNull() // R4 : le seul candidat est abandonné
    expect(res.directionMismatches).toBe(1)
  })

  it("delta nul (proposé == live) sur un reason directionnel → abandon SILENCIEUX, pas un mismatch", () => {
    // proposedValue 10 == live[6].value 10 → no-op ; ne doit PAS être compté comme directionMismatch (log error).
    const res = assembleGroupedDisposition(live, [cand({ reason: "icrTooHigh", proposedValue: 10 })], 14, ICR)
    expect(res.disposition).toBeNull()
    expect(res.directionMismatches).toBe(0)
  })

  it("dérive de valeur (currentValue ≠ live) → abandonné (R2)", () => {
    const res = assembleGroupedDisposition(live, [cand({ currentValue: 11 })], 14, ICR) // live[6].value = 10
    expect(res.disposition).toBeNull()
    expect(res.directionMismatches).toBe(0)
  })

  it("dérive de endHour → abandonné (R2)", () => {
    const res = assembleGroupedDisposition(live, [cand({ endHour: 11 })], 14, ICR) // live[6].endHour = 12
    expect(res.disposition).toBeNull()
  })

  it("startHour absent du live → abandonné", () => {
    const res = assembleGroupedDisposition(live, [cand({ startHour: 20, endHour: 22 })], 14, ICR)
    expect(res.disposition).toBeNull()
  })

  it("liste vide de candidats → no-op", () => {
    const res = assembleGroupedDisposition(live, [], 14, ICR)
    expect(res.disposition).toBeNull()
    expect(res.rationale).toEqual([])
  })
})

describe("assembleGroupedDisposition — PLAFONNEMENT à la borne (US-2663 S5, D1)", () => {
  const ICR = { min: 3, max: 30 } // bornes ICR (g/U)
  const live = [{ startHour: 6, endHour: 12, value: 28 }]
  const cand = (proposedValue: number, reason = "icrTooLow") => ([{
    startHour: 6, endHour: 12,
    cand: { parameterType: "insulinToCarbRatio", reason, currentValue: 28, proposedValue, changePercent: 10, confidence: "high", supportingEvents: 8, totalEventsConsidered: 8 },
  }] as never)

  it("valeur calculée > max → proposée À LA BORNE + cappedToBound + valeur brute", () => {
    const res = assembleGroupedDisposition(live, cand(35), 14, ICR)! // 35 > max 30
    expect(res.disposition![0]!.value).toBe(30) // plafonné à la borne
    expect(res.rationale[0]).toMatchObject({ cappedToBound: true, cappedFromValue: 35 })
  })

  it("valeur calculée dans les bornes → PAS de plafonnement (cappedToBound absent)", () => {
    const res = assembleGroupedDisposition(live, cand(29), 14, ICR)! // 29 ≤ 30
    expect(res.disposition![0]!.value).toBe(29)
    expect(res.rationale[0]!.cappedToBound).toBeUndefined()
  })

  it("créneau DÉJÀ à la borne + calcul dépasse → plafonné == live → delta 0 → no-op (rien proposé)", () => {
    const atMax = [{ startHour: 6, endHour: 12, value: 30 }]
    const res = assembleGroupedDisposition(atMax, [{ startHour: 6, endHour: 12, cand: { parameterType: "insulinToCarbRatio", reason: "icrTooLow", currentValue: 30, proposedValue: 34, changePercent: 10, confidence: "high", supportingEvents: 8, totalEventsConsidered: 8 } }] as never, 14, ICR)
    expect(res.disposition).toBeNull()
  })

  it("valeur calculée < min (vers PLUS d'insuline) → plafonnée AU PLANCHER + cappedToBound", () => {
    const liveNearMin = [{ startHour: 6, endHour: 12, value: 4 }] // proche du min ICR (3)
    const c = [{ startHour: 6, endHour: 12, cand: { parameterType: "insulinToCarbRatio", reason: "icrTooHigh", currentValue: 4, proposedValue: 2, changePercent: -50, confidence: "high", supportingEvents: 8, totalEventsConsidered: 8 } }] as never
    const res = assembleGroupedDisposition(liveNearMin, c, 14, ICR)! // 2 < min 3
    expect(res.disposition![0]!.value).toBe(3) // plafonné au plancher
    expect(res.rationale[0]).toMatchObject({ cappedToBound: true, cappedFromValue: 2 })
  })

  it("base LEGACY hors-borne → abandon par la garde d'intégrité de base (finding #1)", () => {
    // Live 32 > max 30 (donnée legacy). La garde `isBaseOutOfBounds` abandonne le créneau AVANT le check de
    // direction → `disposition` null ET `directionMismatches` = 0 (le contrôle de sens n'est jamais atteint).
    const liveOob = [{ startHour: 6, endHour: 12, value: 32 }] // > max 30 (donnée legacy)
    const c = [{ startHour: 6, endHour: 12, cand: { parameterType: "insulinToCarbRatio", reason: "icrTooLow", currentValue: 32, proposedValue: 35, changePercent: 10, confidence: "high", supportingEvents: 8, totalEventsConsidered: 8 } }] as never
    const res = assembleGroupedDisposition(liveOob, c, 14, ICR)
    expect(res.disposition).toBeNull()
    expect(res.directionMismatches).toBe(0) // garde d'intégrité de base atteinte avant la garde de direction
  })

  it("base hors-borne + clamp MÊME sens que reason → abandonné (finding #1, pas de titration hors-cap depuis base invalide)", () => {
    // Live 32 > max 30. reason baisse (icrTooHigh), proposé 31 : SANS la garde, le clamp 31→30 donnerait un
    // delta 30−32 = −2 (baisse cohérente) et persisterait un mouvement potentiellement > cap de titration.
    // AVEC la garde d'intégrité de base → le créneau est abandonné (jamais titrer depuis une base invalide).
    const liveOob = [{ startHour: 6, endHour: 12, value: 32 }] // > max 30 (donnée legacy)
    const c = [{ startHour: 6, endHour: 12, cand: { parameterType: "insulinToCarbRatio", reason: "icrTooHigh", currentValue: 32, proposedValue: 31, changePercent: -3, confidence: "high", supportingEvents: 8, totalEventsConsidered: 8 } }] as never
    const res = assembleGroupedDisposition(liveOob, c, 14, ICR)
    expect(res.disposition).toBeNull()
  })

  it("levier STYLO (U TOTALES) : plafonnement au plancher MDI_BASAL_MIN_U, jamais les bornes pompe", () => {
    const liveStylo = [{ kind: "daily" as const, value: 1 }]
    const STYLO = { min: 0.5, max: 9999.99 } // U totales (PAS BASAL_MIN/MAX pompe)
    const c = [{ kind: "daily", cand: { parameterType: "basalRate", reason: "basalTooHigh", currentValue: 1, proposedValue: 0.2, changePercent: -80, confidence: "medium", supportingEvents: 4, totalEventsConsidered: 4 } }] as never
    const res = assembleGroupedStyloDisposition(liveStylo, c, 7, STYLO)! // 0,2 < plancher 0,5
    expect(res.disposition).toEqual([{ kind: "daily", value: 0.5 }])
    expect(res.rationale[0]).toMatchObject({ basalDoseKind: "daily", cappedToBound: true, cappedFromValue: 0.2 })
  })
})

describe("assembleGroupedPumpDisposition (US-2663 S3c, cœur pur POMPE)", () => {
  const PUMP = { min: 0.05, max: 5 } // bornes basale pompe (U/h), débits live ⊂ bornes → no-op
  const livePump = [
    { id: "noct", startTime: "00:00", endTime: "06:00", rate: 0.8 },
    { id: "day", startTime: "06:00", endTime: "00:00", rate: 1.1 },
  ]
  const pumpCand = (over: Partial<{ slotId: string; startHour: number; currentValue: number; proposedValue: number; reason: string }> = {}) => ({
    slotId: over.slotId ?? "noct",
    startHour: over.startHour ?? 0,
    cand: {
      parameterType: "basalRate",
      reason: over.reason ?? "basalTooLow", // hausse attendue
      currentValue: over.currentValue ?? 0.8,
      proposedValue: over.proposedValue ?? 0.85,
      changePercent: 6,
      confidence: "high",
      supportingEvents: 5,
      totalEventsConsidered: 5,
    },
  }) as never

  it("créneau nocturne changé → superposé, autres inchangés, temps EXACTS préservés, rationale clé startHour", () => {
    const res = assembleGroupedPumpDisposition(livePump, [pumpCand()], 14, PUMP)!
    expect(res.disposition).toEqual([
      { startTime: "00:00", endTime: "06:00", rate: 0.85 }, // hausse nocturne
      { startTime: "06:00", endTime: "00:00", rate: 1.1 }, // inchangé
    ])
    expect(res.rationale).toHaveLength(1)
    expect(res.rationale[0]).toMatchObject({ startHour: 0, reason: "basalTooLow", analysisPeriod: 14 })
    expect(res.directionMismatches).toBe(0)
  })

  it("garde direction : basalTooLow (hausse) mais BAISSE proposée → abandonné + comptabilisé", () => {
    const res = assembleGroupedPumpDisposition(livePump, [pumpCand({ reason: "basalTooLow", proposedValue: 0.75 })], 14, PUMP)
    expect(res.disposition).toBeNull()
    expect(res.directionMismatches).toBe(1)
  })

  it("dérive de débit (currentValue ≠ live rate) → abandonné (R2)", () => {
    const res = assembleGroupedPumpDisposition(livePump, [pumpCand({ currentValue: 0.9 })], 14, PUMP) // live noct = 0.8
    expect(res.disposition).toBeNull()
  })

  it("slotId absent du live → abandonné", () => {
    const res = assembleGroupedPumpDisposition(livePump, [pumpCand({ slotId: "ghost" })], 14, PUMP)
    expect(res.disposition).toBeNull()
  })
})

describe("proposalGeneratorService — émission GROUPÉE POMPE (US-2663 S3c)", () => {
  beforeEach(() => vi.clearAllMocks())

  /** Config pompe : créneau nocturne [0,6) débit 0,8 + créneau jour [6,0) débit 1,1. */
  function setupPump() {
    mode.mockResolvedValue({ mode: "basalBolus", coherent: true } as never)
    getSettings.mockResolvedValue({
      // Un créneau ICR présent (sinon retour précoce `noCarbRatios`) mais AUCUN repas → pas de candidat ICR.
      carbRatios: [{ startHour: 12, endHour: 14, gramsPerUnit: 10 }], sensitivityFactors: [],
      basalConfiguration: {
        configType: "pump",
        pumpSlots: [
          { id: "noct", rate: 0.8, startTime: new Date(Date.UTC(1970, 0, 1, 0)), endTime: new Date(Date.UTC(1970, 0, 1, 6)) },
          { id: "day", rate: 1.1, startTime: new Date(Date.UTC(1970, 0, 1, 6)), endTime: new Date(Date.UTC(1970, 0, 1, 0)) },
        ],
      },
      glucoseTargets: [{ targetGlucose: 110 }],
      basalInsulin: undefined,
    } as never)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1", pregnancyMode: false } as never)
    dailyJournal.mockResolvedValue([] as never)
    // 4 nuits : à jeun HAUT (1,60 g/L > cible ~1,10) + nadir nocturne SÛR (1,20, non hypo) → basalTooLow (hausse),
    // couverture Somogyi OK (≥ 3 nadirs). → candidat de HAUSSE du créneau nocturne.
    fastingTrend.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({ fastingMgdl: 160, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(i) })) as never,
    )
    createSet.mockResolvedValue({ id: "sp" } as never)
    // Relecture LIVE des créneaux pompe (emitGroupedPumpBasal) — mêmes id/temps/débits que la config.
    prismaMock.pumpBasalSlot.findMany.mockResolvedValue([
      { id: "noct", startTime: new Date("1970-01-01T00:00:00Z"), endTime: new Date("1970-01-01T06:00:00Z"), rate: 0.8 },
      { id: "day", startTime: new Date("1970-01-01T06:00:00Z"), endTime: new Date("1970-01-01T00:00:00Z"), rate: 1.1 },
    ] as never)
  }

  it("émet UNE SlotSetProposal basalRate (disposition pompe entière, hausse nocturne)", async () => {
    setupPump()
    const res = await proposalGeneratorService.generateForPatient(1, 99)

    const call = createSet.mock.calls.find((c) => c[0]?.parameterType === "basalRate")
    expect(call).toBeDefined()
    expect(call![0].proposer).toEqual({ userId: null, source: "algorithm" })
    const disp = call![0].proposedSlots as { startTime: string; rate: number }[]
    expect(disp).toHaveLength(2)
    expect(disp.find((s) => s.startTime === "00:00")!.rate).toBeGreaterThan(0.8) // hausse nocturne
    expect(disp.find((s) => s.startTime === "06:00")!.rate).toBe(1.1) // créneau jour inchangé
    expect(call![0].baselineOverride).toHaveLength(2) // baseline injecté = lecture live (TOCTOU fermée)
    expect(res.created).toBe(1)
  })

  it("US-2663 (S5) — GROUPED-ONLY POMPE : sans flag, émet groupé (jamais par-valeur)", async () => {
    setupPump()
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet.mock.calls.find((c) => c[0]?.parameterType === "basalRate")).toBeDefined()
    expect(res.created).toBe(1)
  })
})

describe("assembleGroupedFixedDose (US-2663 S3d PR2, cœur pur DOSE FIXE)", () => {
  const FIXED = { min: 0.5, max: 999.99 } // bornes dose fixe (U), doses live ⊂ bornes → no-op
  const live = [
    { usage: "bolus", moment: "morning", value: 6 },
    { usage: "basal", moment: "evening", value: 20 },
  ]
  const fdCand = (over: Partial<{ usage: string; moment: string; currentValue: number; proposedValue: number; reason: string }> = {}) => ({
    usage: over.usage ?? "bolus",
    moment: over.moment ?? "morning",
    cand: {
      parameterType: "fixedDose",
      reason: over.reason ?? "fixedDoseTooLow", // hausse attendue
      currentValue: over.currentValue ?? 6,
      proposedValue: over.proposedValue ?? 7,
      changePercent: 16,
      confidence: "medium",
      supportingEvents: 4,
      totalEventsConsidered: 4,
    },
  }) as never

  it("dose changée cohérente → superposée par (usage,moment), autres inchangées, rationale clé (usage,moment)", () => {
    const res = assembleGroupedFixedDose(live as never, [fdCand()], 14, FIXED)!
    expect(res.disposition).toEqual([
      { usage: "bolus", moment: "morning", value: 7 }, // changé (hausse)
      { usage: "basal", moment: "evening", value: 20 }, // inchangé
    ])
    expect(res.rationale).toHaveLength(1)
    expect(res.rationale[0]).toMatchObject({ usage: "bolus", moment: "morning", reason: "fixedDoseTooLow", analysisPeriod: 14 })
    expect(res.directionMismatches).toBe(0)
  })

  it("garde direction : fixedDoseTooLow (hausse) mais BAISSE proposée → abandonné + comptabilisé", () => {
    const res = assembleGroupedFixedDose(live as never, [fdCand({ reason: "fixedDoseTooLow", proposedValue: 5 })], 14, FIXED)
    expect(res.disposition).toBeNull()
    expect(res.directionMismatches).toBe(1)
  })

  it("même moment mais USAGE différent → clés distinctes (pas de collision bolus/basal)", () => {
    // basal/evening 20 → 22 (hausse) ; bolus/morning inchangé. La clé (usage,moment) distingue.
    const res = assembleGroupedFixedDose(live as never, [fdCand({ usage: "basal", moment: "evening", currentValue: 20, proposedValue: 22 })], 14, FIXED)!
    expect(res.disposition!.find((s: { usage: string }) => s.usage === "basal")!.value).toBe(22)
    expect(res.disposition!.find((s: { usage: string }) => s.usage === "bolus")!.value).toBe(6)
  })

  it("dérive de valeur (currentValue ≠ live) → abandonné (R2)", () => {
    const res = assembleGroupedFixedDose(live as never, [fdCand({ currentValue: 7 })], 14, FIXED) // live bolus/morning = 6
    expect(res.disposition).toBeNull()
  })

  it("clé (usage,moment) absente du live → abandonné", () => {
    const res = assembleGroupedFixedDose(live as never, [fdCand({ moment: "night" })], 14, FIXED)
    expect(res.disposition).toBeNull()
  })
})

describe("proposalGeneratorService — émission GROUPÉE DOSE FIXE (US-2663 S3d PR2)", () => {
  beforeEach(() => vi.clearAllMocks())

  /** Config doses simples : selon `slots` (défaut = bolus/morning 6 U). Creux pré-dose HAUTS → fixedDoseTooLow (hausse). */
  function setupFixedDose(slots: { usage: string; moment: string; valueU: number }[] = [{ usage: "bolus", moment: "morning", valueU: 6 }], troughGl = 1.6) {
    mode.mockResolvedValue({ mode: "fixedDose", coherent: true } as never)
    prismaMock.fixedDoseSlot.findMany.mockResolvedValue(
      slots.map((s) => ({ moment: s.moment, valueU: s.valueU, patientInsulin: { usage: s.usage } })) as never,
    )
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT2", pregnancyMode: false } as never)
    prismaMock.glucoseTarget.findFirst.mockResolvedValue({ targetGlucose: 100 } as never) // cible ~1,0 g/L
    // Creux pré-dose : HAUTS (1,6 g/L) → dose trop basse → hausse (défaut) ; BAS (0,6) → dose trop haute → BAISSE.
    const troughs: Record<string, { gl: number; dayIso: string }[]> = {}
    for (const s of slots) troughs[s.moment] = Array.from({ length: 4 }, (_, i) => ({ gl: troughGl, dayIso: isoDaysAgo(i) }))
    fixedDoseTrend.mockResolvedValue(troughs as never)
    createSet.mockResolvedValue({ id: "sf" } as never)
    // Relecture live (emit) — même forme que la config active.
    getFixedDoseSlots.mockResolvedValue(slots.map((s) => ({ usage: s.usage, moment: s.moment, value: s.valueU })) as never)
  }

  it("émet UNE SlotSetProposal fixedDose (clé usage+moment, hausse)", async () => {
    setupFixedDose()
    const res = await proposalGeneratorService.generateForPatient(1, 99)

    const call = createSet.mock.calls.find((c) => c[0]?.parameterType === "fixedDose")
    expect(call).toBeDefined()
    expect(call![0].proposer).toEqual({ userId: null, source: "algorithm" })
    const disp = call![0].proposedSlots as { usage: string; moment: string; value: number }[]
    expect(disp).toHaveLength(1)
    expect(disp[0]).toMatchObject({ usage: "bolus", moment: "morning" })
    expect(disp[0].value).toBeGreaterThan(6) // hausse
    // Fenêtre TOCTOU fermée : baseline injecté = la MÊME lecture live (getFixedDoseSlots).
    expect(call![0].baselineOverride).toEqual([{ usage: "bolus", moment: "morning", value: 6 }])
    expect(res.created).toBe(1)
  })

  it("US-2663 (S5) — GROUPED-ONLY DOSE FIXE : émet groupé (jamais par-valeur)", async () => {
    setupFixedDose()
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet.mock.calls.find((c) => c[0]?.parameterType === "fixedDose")).toBeDefined()
    expect(res.created).toBe(1)
  })

  it("D2 — moment MULTI-DOSES (bolus + basal au même moment) → ABANDONNÉ (aucune proposition ni par-valeur)", async () => {
    // Deux doses au moment « evening » (bolus + basal) → signal non attribuable → abandon (D2).
    setupFixedDose([
      { usage: "bolus", moment: "evening", valueU: 6 },
      { usage: "basal", moment: "evening", valueU: 20 },
    ])
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet).not.toHaveBeenCalled() // moment multi-doses jamais titré
    expect(res.created).toBe(0)
  })

  it("D2 — moment multi-doses avec HYPO (candidat de BAISSE abandonné) → lève un ClinicalReviewFlag (jamais silencieux)", async () => {
    // Creux BAS (0,6 g/L) → dose trop haute → candidat de BAISSE ; moment « evening » multi-doses → abandon.
    // Garde-fou medical : l'abandon d'une baisse (signal hypo) DOIT alerter le médecin (flag), pas juste logger.
    setupFixedDose([
      { usage: "bolus", moment: "evening", valueU: 6 },
      { usage: "basal", moment: "evening", valueU: 20 },
    ], 0.6)
    await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet).not.toHaveBeenCalled() // toujours pas de titration groupée
    expect(raiseFlag).toHaveBeenCalledWith(1, "highVariabilityFixedDose", 99, undefined) // hypo surfacée au médecin
  })
})

describe("assembleGroupedStyloDisposition (US-2663 S3e PR2, cœur pur BASALE STYLO)", () => {
  const STYLO_B = { min: 0.5, max: 9999.99 } // bornes basale stylo (U totales), doses live ⊂ bornes → no-op
  const stCand = (over: Partial<{ kind: "daily" | "morning" | "evening"; currentValue: number; proposedValue: number; reason: string }> = {}) => ({
    kind: over.kind ?? "daily",
    cand: {
      parameterType: "basalRate",
      reason: over.reason ?? "basalTooLow", // hausse attendue
      currentValue: over.currentValue ?? 20,
      proposedValue: over.proposedValue ?? 21,
      changePercent: 5,
      confidence: "medium",
      supportingEvents: 4,
      totalEventsConsidered: 4,
    },
  }) as never

  it("dose daily changée → superposée, rationale clé basalDoseKind", () => {
    const res = assembleGroupedStyloDisposition([{ kind: "daily", value: 20 }], [stCand()], 7, STYLO_B)!
    expect(res.disposition).toEqual([{ kind: "daily", value: 21 }])
    expect(res.rationale).toHaveLength(1)
    expect(res.rationale[0]).toMatchObject({ basalDoseKind: "daily", reason: "basalTooLow", analysisPeriod: 7 })
    expect(res.directionMismatches).toBe(0)
  })

  it("split : une dose changée (evening), l'autre (morning) garde sa valeur live", () => {
    const live = [{ kind: "morning" as const, value: 12 }, { kind: "evening" as const, value: 10 }]
    const res = assembleGroupedStyloDisposition(live, [stCand({ kind: "evening", currentValue: 10, proposedValue: 9, reason: "basalTooHigh" })], 7, STYLO_B)!
    expect(res.disposition).toEqual([{ kind: "morning", value: 12 }, { kind: "evening", value: 9 }])
    expect(res.rationale[0]).toMatchObject({ basalDoseKind: "evening", reason: "basalTooHigh" })
  })

  it("garde direction : basalTooLow (hausse) mais BAISSE proposée → abandonné + comptabilisé", () => {
    const res = assembleGroupedStyloDisposition([{ kind: "daily", value: 20 }], [stCand({ reason: "basalTooLow", proposedValue: 19 })], 7, STYLO_B)
    expect(res.disposition).toBeNull()
    expect(res.directionMismatches).toBe(1)
  })

  it("dérive de valeur (currentValue ≠ live) → abandonné (R2)", () => {
    const res = assembleGroupedStyloDisposition([{ kind: "daily", value: 20 }], [stCand({ currentValue: 21 })], 7, STYLO_B) // live daily = 20
    expect(res.disposition).toBeNull()
  })

  it("kind absent du live (bascule de modalité) → abandonné", () => {
    const res = assembleGroupedStyloDisposition([{ kind: "morning", value: 12 }, { kind: "evening", value: 10 }], [stCand({ kind: "daily" })], 7, STYLO_B)
    expect(res.disposition).toBeNull()
  })

  it("no-op (delta 0) → disposition null", () => {
    const res = assembleGroupedStyloDisposition([{ kind: "daily", value: 20 }], [stCand({ proposedValue: 20 })], 7, STYLO_B)
    expect(res.disposition).toBeNull()
  })
})

describe("proposalGeneratorService — émission GROUPÉE STYLO (US-2663 S3e PR2)", () => {
  beforeEach(() => vi.clearAllMocks())

  /** Config stylo single : dose lente 20 U. À jeun HAUT (1,60 g/L > cible ~1,10) + nadir nocturne SÛR → basalTooLow (hausse). */
  function setupStyloSingle() {
    mode.mockResolvedValue({ mode: "basalBolus", coherent: true } as never)
    getSettings.mockResolvedValue({
      carbRatios: [{ startHour: 12, endHour: 14, gramsPerUnit: 10 }], sensitivityFactors: [],
      basalConfiguration: { configType: "single_injection", dailyDose: 20, morningDose: null, eveningDose: null },
      glucoseTargets: [{ targetGlucose: 110 }],
      basalInsulin: undefined,
    } as never)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1", pregnancyMode: false } as never)
    dailyJournal.mockResolvedValue([] as never)
    fastingTrend.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({ fastingMgdl: 160, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(i) })) as never,
    )
    createSet.mockResolvedValue({ id: "ss" } as never)
    // Relecture LIVE de la dose stylo (emitGroupedStyloBasal) — même valeur que la config.
    getStyloBasalSlots.mockResolvedValue([{ kind: "daily", value: 20 }] as never)
  }

  it("émet UNE SlotSetProposal basalRate de forme STYLO (kind daily, hausse), baseline injecté", async () => {
    setupStyloSingle()
    const res = await proposalGeneratorService.generateForPatient(1, 99)

    const call = createSet.mock.calls.find((c) => c[0]?.parameterType === "basalRate")
    expect(call).toBeDefined()
    expect(call![0].proposer).toEqual({ userId: null, source: "algorithm" })
    const disp = call![0].proposedSlots as { kind: string; value: number }[]
    expect(disp).toHaveLength(1)
    expect(disp[0]!.kind).toBe("daily")
    expect(disp[0]!.value).toBeGreaterThan(20) // hausse
    const rationale = call![0].rationale as { basalDoseKind: string; reason: string }[]
    expect(rationale[0]).toMatchObject({ basalDoseKind: "daily", reason: "basalTooLow" })
    expect(call![0].baselineOverride).toEqual([{ kind: "daily", value: 20 }]) // TOCTOU fermée
    expect(res.created).toBe(1)
  })

  it("US-2663 (S5) — GROUPED-ONLY STYLO : émet une proposition groupée (voie par-valeur retirée)", async () => {
    setupStyloSingle()
    const res = await proposalGeneratorService.generateForPatient(1, 99)
    expect(createSet.mock.calls.find((c) => c[0]?.parameterType === "basalRate")).toBeDefined()
    expect(res.created).toBe(1)
  })

  it("split : la dose gagnante (soir, à jeun HAUT) est superposée, matin (pas de signal) inchangé", async () => {
    mode.mockResolvedValue({ mode: "basalBolus", coherent: true } as never)
    getSettings.mockResolvedValue({
      carbRatios: [{ startHour: 12, endHour: 14, gramsPerUnit: 10 }], sensitivityFactors: [],
      basalConfiguration: { configType: "split_injection", dailyDose: null, morningDose: 12, eveningDose: 10 },
      glucoseTargets: [{ targetGlucose: 110 }],
      basalInsulin: undefined,
    } as never)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1", pregnancyMode: false } as never)
    dailyJournal.mockResolvedValue([] as never) // aucun signal pré-dîner → pas de candidat MATIN
    fastingTrend.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({ fastingMgdl: 160, nocturnalNadirMgdl: 120, dayIso: isoDaysAgo(i) })) as never,
    )
    createSet.mockResolvedValue({ id: "sp2" } as never)
    getStyloBasalSlots.mockResolvedValue([{ kind: "morning", value: 12 }, { kind: "evening", value: 10 }] as never)

    const res = await proposalGeneratorService.generateForPatient(1, 99)
    const call = createSet.mock.calls.find((c) => c[0]?.parameterType === "basalRate")
    expect(call).toBeDefined()
    const disp = call![0].proposedSlots as { kind: string; value: number }[]
    expect(disp.find((s) => s.kind === "evening")!.value).toBeGreaterThan(10) // soir titré (hausse)
    expect(disp.find((s) => s.kind === "morning")!.value).toBe(12) // matin inchangé
    const rationale = call![0].rationale as { basalDoseKind: string }[]
    expect(rationale).toHaveLength(1)
    expect(rationale[0]!.basalDoseKind).toBe("evening")
    expect(res.created).toBe(1)
  })

  /**
   * Config split. `fasting` (dose SOIR, garde nocturne) : à jeun `fastGl` + nadir nocturne `noctGl`.
   * `dailyJournal` (dose MATIN) : dîners (pré-dîner `preGl`) + repas du matin (nadir de jour `dayNadGl`),
   * SANS bolus de midi (pas de confondeur). Doses live soir 10 / matin 12.
   */
  function setupStyloSplit(opts: { fastGl: number; noctGl: number; preGl: number; dayNadGl: number }) {
    mode.mockResolvedValue({ mode: "basalBolus", coherent: true } as never)
    getSettings.mockResolvedValue({
      carbRatios: [{ startHour: 12, endHour: 14, gramsPerUnit: 10 }], sensitivityFactors: [],
      basalConfiguration: { configType: "split_injection", dailyDose: null, morningDose: 12, eveningDose: 10 },
      glucoseTargets: [{ targetGlucose: 110 }], // cible ~1,1 g/L
      basalInsulin: undefined,
    } as never)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1", pregnancyMode: false } as never)
    fastingTrend.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({ fastingMgdl: opts.fastGl * 100, nocturnalNadirMgdl: opts.noctGl * 100, dayIso: isoDaysAgo(i) })) as never,
    )
    dailyJournal.mockResolvedValue([
      ...Array.from({ length: 4 }, (_, i) => ({ moment: "evening", preMgdl: opts.preGl * 100, nadirMgdl: 120, bolus: 0, dayIso: isoDaysAgo(i) })),
      ...Array.from({ length: 4 }, (_, i) => ({ moment: "morning", preMgdl: 100, nadirMgdl: opts.dayNadGl * 100, bolus: 0, dayIso: isoDaysAgo(i) })),
    ] as never)
    createSet.mockResolvedValue({ id: "sp3" } as never)
    getStyloBasalSlots.mockResolvedValue([{ kind: "morning", value: 12 }, { kind: "evening", value: 10 }] as never)
  }

  it("split : dé-escalade SOIR (hypo) prioritaire sur titration MATIN → SOIR gagnante émise, MATIN sans flag", async () => {
    // Soir : à jeun en bande (1,1) + nadirs nocturnes hypo récurrente (0,55) → dé-escalade soir.
    // Matin : pré-dîner HAUT (1,7) + nadirs de jour sûrs (1,2) → titration matin (hausse). Priorité sécurité → soir.
    setupStyloSplit({ fastGl: 1.1, noctGl: 0.55, preGl: 1.7, dayNadGl: 1.2 })
    const res = await proposalGeneratorService.generateForPatient(1, 99)

    const call = createSet.mock.calls.find((c) => c[0]?.parameterType === "basalRate")
    expect(call).toBeDefined()
    const disp = call![0].proposedSlots as { kind: string; value: number }[]
    expect(disp.find((s) => s.kind === "evening")!.value).toBeLessThan(10) // dé-escalade soir gagnante
    expect(disp.find((s) => s.kind === "morning")!.value).toBe(12) // matin (titration perdante) inchangé
    const rationale = call![0].rationale as { basalDoseKind: string }[]
    expect(rationale).toHaveLength(1)
    expect(rationale[0]!.basalDoseKind).toBe("evening")
    // La perdante MATIN est une TITRATION (pas une dé-escalade) → aucun flag levé (défère au run suivant).
    expect(raiseFlag).not.toHaveBeenCalled()
    expect(res.created).toBe(1)
  })

  it("split : DEUX dé-escalades → SOIR gagnante émise + MATIN perdante lève TOUJOURS son flag (fail-loud préservé)", async () => {
    // Soir : nadirs nocturnes hypo récurrente (0,55) → dé-escalade. Matin : pré-dîner en bande (1,1) +
    // nadirs de jour hypo récurrente (0,55) → dé-escalade. Gagnante = soir (priorité à égalité) ; perdante = matin.
    setupStyloSplit({ fastGl: 1.1, noctGl: 0.55, preGl: 1.1, dayNadGl: 0.55 })
    const res = await proposalGeneratorService.generateForPatient(1, 99)

    const call = createSet.mock.calls.find((c) => c[0]?.parameterType === "basalRate")
    expect(call).toBeDefined()
    expect((call![0].rationale as { basalDoseKind: string }[])[0]!.basalDoseKind).toBe("evening")
    // Fail-loud préservé en mode GROUPÉ : la dé-escalade PERDANTE (matin) lève son flag de jour (US-2661).
    expect(raiseFlag).toHaveBeenCalledWith(1, "daytimeHypoHighPreDinner", 99, undefined)
    // Verrou de non-régression : UN SEUL flag levé — la GAGNANTE (soir) ne lève aucun flag parasite.
    expect(raiseFlag).toHaveBeenCalledTimes(1)
    expect(res.created).toBe(1)
  })
})
