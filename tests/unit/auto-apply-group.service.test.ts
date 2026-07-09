/**
 * US-2657 (slice C3b) — Orchestrateur GROUPÉ `applyExpertGroupGoverned`.
 * Comportement testé : rejet dur (bornes), restructuration → proposition groupée, cap nombre (>2) →
 * proposition, no-op, frontière MDR, triple verrou, décision TOUT-OU-RIEN (tous AUTO_APPLY → replaceSlotSet ;
 * un seul créneau hors enveloppe → groupe entier en proposition). `assertValidSlotSet` = vraie impl.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/env", () => ({ isAutoApplyGloballyEnabled: vi.fn() }))
vi.mock("@/lib/insulin/auto-apply-context", () => ({ buildEnvelopeContext: vi.fn() }))
vi.mock("@/lib/insulin/auto-apply-envelope", () => ({ evaluateAutoApplyEnvelope: vi.fn() }))
vi.mock("@/lib/services/insulin-therapy.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/insulin-therapy.service")>()
  return {
    ...actual, // garde le vrai assertValidSlotSet
    insulinTherapyService: {
      replaceSlotSet: vi.fn().mockResolvedValue({ applied: true, count: 3, coverage: { hasGap: false, hasOverlap: false }, supersededProposalIds: [], supersededSetProposalIds: [] }),
      updateIsf: vi.fn(),
      updateIcr: vi.fn(),
      updatePumpSlot: vi.fn(),
    },
  }
})
vi.mock("@/lib/services/adjustment.service", () => ({ adjustmentService: { createProposal: vi.fn() } }))
vi.mock("@/lib/services/treatment-mode.service", () => ({ treatmentModeService: { resolveTreatmentMode: vi.fn() } }))
vi.mock("@/lib/services/slot-set-proposal.service", () => ({
  slotSetProposalService: { createSetProposal: vi.fn().mockResolvedValue({ id: "set-1" }) },
  REPLACE_KEY: { insulinSensitivityFactor: "isf", insulinToCarbRatio: "icr" },
}))
vi.mock("@/lib/services/audit.service", () => ({ auditService: { log: vi.fn().mockResolvedValue(undefined), logWithTx: vi.fn() } }))

const { autoApplyService, exceedsGroupCumulativeAmplitude } = await import("@/lib/services/auto-apply.service")
const { isAutoApplyGloballyEnabled } = await import("@/lib/env")
const { buildEnvelopeContext } = await import("@/lib/insulin/auto-apply-context")
const { evaluateAutoApplyEnvelope } = await import("@/lib/insulin/auto-apply-envelope")
const { insulinTherapyService } = await import("@/lib/services/insulin-therapy.service")
const { treatmentModeService } = await import("@/lib/services/treatment-mode.service")
const { slotSetProposalService } = await import("@/lib/services/slot-set-proposal.service")

const globalOn = vi.mocked(isAutoApplyGloballyEnabled)
const buildCtx = vi.mocked(buildEnvelopeContext)
const evaluate = vi.mocked(evaluateAutoApplyEnvelope)
const resolveMode = vi.mocked(treatmentModeService.resolveTreatmentMode)
const NOW = new Date("2026-07-09T12:00:00Z")

// Jeu ISF courant : 3 créneaux, couverture 24 h, valeurs ∈ [0.10, 1.00] g/L.
const CURRENT = [
  { startHour: 0, endHour: 8, sensitivityFactorGl: 0.5 },
  { startHour: 8, endHour: 22, sensitivityFactorGl: 0.45 },
  { startHour: 22, endHour: 0, sensitivityFactorGl: 0.4 },
]
const edit = (proposedSlots: Array<{ startHour: number; endHour: number; value: number }>) => ({
  patientId: 7,
  parameterType: "insulinSensitivityFactor" as const,
  proposedSlots,
})
// Mêmes frontières que CURRENT ; 2 valeurs modifiées.
const CHANGED_2 = [
  { startHour: 0, endHour: 8, value: 0.52 },
  { startHour: 8, endHour: 22, value: 0.47 },
  { startHour: 22, endHour: 0, value: 0.4 },
]

let tx: any

describe("autoApplyService.applyExpertGroupGoverned", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalOn.mockReturnValue(true)
    resolveMode.mockResolvedValue({ mode: "basalBolus" } as never)
    prismaMock.patient.findFirst.mockResolvedValue({ maturityLevel: "EXPERT", autoApply: true } as never)
    prismaMock.governanceApproval.count.mockResolvedValue(1 as never)
    prismaMock.ketoneThreshold.findUnique.mockResolvedValue({ moderateThreshold: 1.5 } as never)
    prismaMock.insulinSensitivityFactor.findMany.mockResolvedValue(CURRENT as never)
    buildCtx.mockResolvedValue({
      glycemia: { glucosesGl: [], hypoGlucosesGl: [], capturePercent: 80, windowDays: 14, recentKetonesMmol: [], ketoneModerateThreshold: 1.5, cgmThresholds: { veryLow: 0.54, low: 0.7, ok: 1.8, high: 2.5 } },
      ratchet: { hoursSinceLastAutoApply: null, cumulativeAbsPercentThisWeek: 0 },
    } as never)
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
      autoApplyEvent: { create: vi.fn().mockResolvedValue({ id: 1 }) },
      patient: { findFirst: vi.fn().mockResolvedValue({ maturityLevel: "EXPERT", autoApply: true }) },
      governanceApproval: { findFirst: vi.fn().mockResolvedValue({ id: 1, reference: "GOV-1" }) },
      // Baseline RELU sous lock (readCurrentSlots via tx) — identique au pré-lock → pas de baselineMoved.
      insulinSensitivityFactor: { findMany: vi.fn().mockResolvedValue(CURRENT) },
    }
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
  })

  it("hors bornes → REJET DUR à la saisie (assertValidSlotSet lève)", async () => {
    const bad = [{ startHour: 0, endHour: 12, value: 5.0 }, { startHour: 12, endHour: 0, value: 0.5 }] // 5.0 > ISF_GL_MAX
    await expect(autoApplyService.applyExpertGroupGoverned(edit(bad), 7, NOW)).rejects.toThrow("valueOutOfBounds")
  })

  it("restructuration (frontières différentes) → proposition GROUPÉE (C2), pas d'apply", async () => {
    prismaMock.insulinSensitivityFactor.findMany.mockResolvedValue(
      [{ startHour: 0, endHour: 12, sensitivityFactorGl: 0.5 }, { startHour: 12, endHour: 0, sensitivityFactorGl: 0.45 }] as never,
    )
    const res = await autoApplyService.applyExpertGroupGoverned(edit(CHANGED_2), 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "C2", proposalId: "set-1" })
    expect(slotSetProposalService.createSetProposal).toHaveBeenCalled()
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
  })

  it("aucune valeur modifiée → noop", async () => {
    const same = [{ startHour: 0, endHour: 8, value: 0.5 }, { startHour: 8, endHour: 22, value: 0.45 }, { startHour: 22, endHour: 0, value: 0.4 }]
    const res = await autoApplyService.applyExpertGroupGoverned(edit(same), 7, NOW)
    expect(res).toEqual({ outcome: "noop" })
  })

  it("frontière MDR : patient nonInsulin → rejected", async () => {
    resolveMode.mockResolvedValue({ mode: "nonInsulin" } as never)
    const res = await autoApplyService.applyExpertGroupGoverned(edit(CHANGED_2), 7, NOW)
    expect(res).toEqual({ outcome: "rejected", reason: "nonInsulinNoDose" })
  })

  it("triple verrou : kill-switch OFF → proposition groupée (C1), pas d'apply", async () => {
    globalOn.mockReturnValue(false)
    const res = await autoApplyService.applyExpertGroupGoverned(edit(CHANGED_2), 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "C1", proposalId: "set-1" })
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
  })

  it("cap groupe : >2 créneaux modifiés → proposition groupée (groupSlots)", async () => {
    const changed3 = [{ startHour: 0, endHour: 8, value: 0.52 }, { startHour: 8, endHour: 22, value: 0.47 }, { startHour: 22, endHour: 0, value: 0.42 }]
    const res = await autoApplyService.applyExpertGroupGoverned(edit(changed3), 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "groupSlots", proposalId: "set-1" })
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
  })

  it("cap ampleur cumulée co-directionnelle (C3b) : 2 baisses ISF à −8 % (sumHypo 16 % > 15 %) → proposition (groupCumulative), pas d'apply", async () => {
    // Chaque créneau (−8 %) est SOUS C3 (10 %) ; seul le cumul co-directionnel (16 %) déclenche. ISF↓ = hypo.
    const coDirectional = [{ startHour: 0, endHour: 8, value: 0.46 }, { startHour: 8, endHour: 22, value: 0.414 }, { startHour: 22, endHour: 0, value: 0.4 }]
    const res = await autoApplyService.applyExpertGroupGoverned(edit(coDirectional), 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "groupCumulative", proposalId: "set-1" })
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
  })

  it("redistribution (1 baisse −8 % hypo + 1 hausse +8 % hyper) : sommes séparées ≤ seuils → AUTO_APPLY (pas de groupCumulative)", async () => {
    // Sens opposés → jamais additionnés (sumHypo 8 ≤ 15, sumHyper 8 ≤ 20) : n'est pas un risque cumulé.
    const redistribution = [{ startHour: 0, endHour: 8, value: 0.46 }, { startHour: 8, endHour: 22, value: 0.486 }, { startHour: 22, endHour: 0, value: 0.4 }]
    const res = await autoApplyService.applyExpertGroupGoverned(edit(redistribution), 7, NOW)
    expect(res).toEqual({ outcome: "applied" })
    expect(insulinTherapyService.replaceSlotSet).toHaveBeenCalled()
  })

  it("tous AUTO_APPLY (2 changés) → application ATOMIQUE (replaceSlotSet + 2 AutoApplyEvent)", async () => {
    const res = await autoApplyService.applyExpertGroupGoverned(edit(CHANGED_2), 7, NOW)
    expect(res).toEqual({ outcome: "applied" })
    expect(insulinTherapyService.replaceSlotSet).toHaveBeenCalledWith("isf", 7, CHANGED_2, 7, undefined, tx)
    expect(tx.autoApplyEvent.create).toHaveBeenCalledTimes(2) // 1 par créneau modifié
    expect(slotSetProposalService.createSetProposal).not.toHaveBeenCalled()
  })

  it("TOUT-OU-RIEN : un seul créneau hors enveloppe → groupe entier en proposition, pas d'apply", async () => {
    evaluate.mockReturnValueOnce({ decision: "AUTO_APPLY" } as never).mockReturnValueOnce({ decision: "FALLBACK_PROPOSAL", failedCheck: "C6" } as never)
    const res = await autoApplyService.applyExpertGroupGoverned(edit(CHANGED_2), 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "C6", proposalId: "set-1" })
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
    expect(slotSetProposalService.createSetProposal).toHaveBeenCalled()
  })

  it("baseline bougé SOUS le lock (édition concurrente) → proposition, PAS d'apply (fail-closed B1)", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    // Sous le lock, le jeu courant relu via tx diffère du pré-lock (1er créneau 0.5 → 0.6) → baselineMoved.
    tx.insulinSensitivityFactor.findMany.mockResolvedValue([
      { startHour: 0, endHour: 8, sensitivityFactorGl: 0.6 },
      { startHour: 8, endHour: 22, sensitivityFactorGl: 0.45 },
      { startHour: 22, endHour: 0, sensitivityFactorGl: 0.4 },
    ])
    const res = await autoApplyService.applyExpertGroupGoverned(edit(CHANGED_2), 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "baselineMoved", proposalId: "set-1" })
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
  })

  it("verrou occupé (mutation concurrente) → proposition, PAS d'apply (fail-closed non bloquant)", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    tx.$queryRaw.mockResolvedValue([{ locked: false }]) // pg_try_advisory_xact_lock = false
    const res = await autoApplyService.applyExpertGroupGoverned(edit(CHANGED_2), 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "busy", proposalId: "set-1" })
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
  })

  it("patient absent/soft-deleted → patientNotFound", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null as never)
    await expect(autoApplyService.applyExpertGroupGoverned(edit(CHANGED_2), 7, NOW)).rejects.toThrow("patientNotFound")
  })
})

// ── Cap d'ampleur cumulée co-directionnelle (C3b) — fonction PURE ────────────────────────────────
// Vecteurs cliniques (medical-domain-validator). ISF : baisse = hypo (plus d'insuline), hausse = hyper.
describe("exceedsGroupCumulativeAmplitude (C3b, pure)", () => {
  const cur = new Map([
    ["0-8", 1.0],
    ["8-22", 1.0],
  ])
  const isf = "insulinSensitivityFactor" as const
  const slot = (key: string, value: number) => {
    const [startHour, endHour] = key.split("-").map(Number)
    return { startHour, endHour, value }
  }

  it("2 co-directionnelles hypo à −10 % (sumHypo 20 > 15) → dépasse", () => {
    expect(exceedsGroupCumulativeAmplitude([slot("0-8", 0.9), slot("8-22", 0.9)], cur, isf)).toBe(true)
  })
  it("2 co-directionnelles hypo à −7,5 % (sumHypo 15, pas > 15) → ne dépasse pas", () => {
    expect(exceedsGroupCumulativeAmplitude([slot("0-8", 0.925), slot("8-22", 0.925)], cur, isf)).toBe(false)
  })
  it("redistribution −10 % / +10 % (hypo 10, hyper 10, chacune ≤ seuil) → ne dépasse pas", () => {
    expect(exceedsGroupCumulativeAmplitude([slot("0-8", 0.9), slot("8-22", 1.1)], cur, isf)).toBe(false)
  })
  it("2 hausses hyper à +10 % (sumHyper 20, pas > 20 — défère à C6b) → ne dépasse pas", () => {
    expect(exceedsGroupCumulativeAmplitude([slot("0-8", 1.1), slot("8-22", 1.1)], cur, isf)).toBe(false)
  })
  it("un seul créneau −10 % (sumHypo 10 ≤ 15, borné par C3) → ne dépasse pas", () => {
    expect(exceedsGroupCumulativeAmplitude([slot("0-8", 0.9)], cur, isf)).toBe(false)
  })
})
