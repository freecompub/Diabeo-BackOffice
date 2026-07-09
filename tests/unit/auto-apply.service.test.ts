/**
 * US-2657 (slice C2b) — Harnais gouverné `applyExpertEditGoverned` (durci epic-hardening).
 * Comportement testé : no-op (aucun changement), garde unité ISF (fail-closed mg/dL), frontière MDR
 * (nonInsulin → rejet), triple verrou (kill-switch × flag × GovernanceApproval active), dispatch par
 * décision (AUTO_APPLY → transaction atomique event+apply+audit `AUTO_APPLIED_SETTING` ; FALLBACK →
 * proposition + `AUTO_APPLY_FALLBACK` ; HARD_REJECT → `AUTO_APPLY_REJECTED`), et re-évaluation sous lock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/env", () => ({ isAutoApplyGloballyEnabled: vi.fn() }))
vi.mock("@/lib/insulin/auto-apply-context", () => ({ buildEnvelopeContext: vi.fn() }))
vi.mock("@/lib/insulin/auto-apply-envelope", () => ({ evaluateAutoApplyEnvelope: vi.fn() }))
vi.mock("@/lib/services/insulin-therapy.service", () => ({
  insulinTherapyService: { updateIsf: vi.fn(), updateIcr: vi.fn(), updatePumpSlot: vi.fn() },
}))
vi.mock("@/lib/services/adjustment.service", () => ({
  adjustmentService: { createProposal: vi.fn().mockResolvedValue({ id: "prop-1" }) },
}))
vi.mock("@/lib/services/treatment-mode.service", () => ({
  treatmentModeService: { resolveTreatmentMode: vi.fn() },
}))
vi.mock("@/lib/services/audit.service", () => ({ auditService: { log: vi.fn(), logWithTx: vi.fn() } }))

const { autoApplyService } = await import("@/lib/services/auto-apply.service")
const { isAutoApplyGloballyEnabled } = await import("@/lib/env")
const { buildEnvelopeContext } = await import("@/lib/insulin/auto-apply-context")
const { evaluateAutoApplyEnvelope } = await import("@/lib/insulin/auto-apply-envelope")
const { insulinTherapyService } = await import("@/lib/services/insulin-therapy.service")
const { adjustmentService } = await import("@/lib/services/adjustment.service")
const { treatmentModeService } = await import("@/lib/services/treatment-mode.service")
const { auditService } = await import("@/lib/services/audit.service")

const globalOn = vi.mocked(isAutoApplyGloballyEnabled)
const buildCtx = vi.mocked(buildEnvelopeContext)
const evaluate = vi.mocked(evaluateAutoApplyEnvelope)
const resolveMode = vi.mocked(treatmentModeService.resolveTreatmentMode)
const NOW = new Date("2026-07-08T12:00:00Z")

const isfEdit = {
  patientId: 7,
  parameterType: "insulinSensitivityFactor" as const,
  slotId: "isf-1",
  startHour: 22,
  endHour: 6,
  currentValue: 0.5,
  proposedValue: 0.48,
  changeKind: "VALUE" as const,
  isfUnit: "gl" as const,
}

// tx factice : advisory lock + re-lecture autorité + autoApplyEvent.create. Le $transaction l'exécute.
let tx: any

describe("autoApplyService.applyExpertEditGoverned", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalOn.mockReturnValue(true)
    resolveMode.mockResolvedValue({ mode: "basalBolus" } as never)
    prismaMock.patient.findFirst.mockResolvedValue({ maturityLevel: "EXPERT", autoApply: true } as never)
    prismaMock.ketoneThreshold.findUnique.mockResolvedValue({ moderateThreshold: 1.5 } as never)
    prismaMock.governanceApproval.count.mockResolvedValue(1 as never) // approbation active par défaut
    buildCtx.mockResolvedValue({
      glycemia: { glucosesGl: [], hypoGlucosesGl: [], capturePercent: 80, windowDays: 14, recentKetonesMmol: [], ketoneModerateThreshold: 1.5, cgmThresholds: { veryLow: 0.54, low: 0.7, ok: 1.8, high: 2.5 } },
      ratchet: { hoursSinceLastAutoApply: null, cumulativeAbsPercentThisWeek: 0 },
    } as never)
    // tx : advisory lock + re-lecture autorité (patient/approval) + event, tous exécutés SOUS le lock.
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
      autoApplyEvent: { create: vi.fn().mockResolvedValue({ id: 1 }) },
      patient: { findFirst: vi.fn().mockResolvedValue({ maturityLevel: "EXPERT", autoApply: true }) },
      governanceApproval: { count: vi.fn().mockResolvedValue(1) },
      // Baseline re-lu sous lock (readSlotValue) — valeurs alignées sur les currentValue des éditions de test.
      insulinSensitivityFactor: { findFirst: vi.fn().mockResolvedValue({ sensitivityFactorGl: 0.5 }) },
      carbRatio: { findFirst: vi.fn().mockResolvedValue({ gramsPerUnit: 10 }) },
      pumpBasalSlot: { findFirst: vi.fn().mockResolvedValue({ rate: 0.8 }) },
    }
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
  })

  it("no-op : proposedValue === currentValue → outcome noop, aucune lecture ni écriture", async () => {
    const res = await autoApplyService.applyExpertEditGoverned({ ...isfEdit, proposedValue: 0.5 }, 7, NOW)
    expect(res).toEqual({ outcome: "noop" })
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled()
  })

  it("garde unité ISF : édition ISF en mg/dL → isfUnitMustBeGl (fail-closed, aucune corruption g/L)", async () => {
    await expect(
      autoApplyService.applyExpertEditGoverned({ ...isfEdit, isfUnit: "mgdl", proposedValue: 45 }, 7, NOW),
    ).rejects.toThrow("isfUnitMustBeGl")
  })

  it("frontière MDR : patient nonInsulin → rejected (aucune enveloppe, aucune dose)", async () => {
    resolveMode.mockResolvedValue({ mode: "nonInsulin" } as never)
    const res = await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(res).toEqual({ outcome: "rejected", reason: "nonInsulinNoDose" })
    expect(evaluate).not.toHaveBeenCalled()
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "AUTO_APPLY_REJECTED" }))
  })

  it("AUTO_APPLY (ISF) → transaction atomique : lock + event + updateIsf(tx) + audit AUTO_APPLIED_SETTING", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    const res = await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(res).toEqual({ outcome: "applied" })
    expect(tx.$queryRaw).toHaveBeenCalled() // advisory lock (try-lock)
    expect(tx.autoApplyEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ patientId: 7, parameterType: "insulinSensitivityFactor", slotKey: "22-6" }) }),
    )
    expect(insulinTherapyService.updateIsf).toHaveBeenCalledWith("isf-1", 0.48, 7, 7, undefined, tx)
    expect(auditService.logWithTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "AUTO_APPLIED_SETTING" }))
    expect(adjustmentService.createProposal).not.toHaveBeenCalled()
  })

  it("AUTO_APPLY (ICR) → updateIcr(tx) ; deltaPercent correct", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    await autoApplyService.applyExpertEditGoverned(
      { ...isfEdit, parameterType: "insulinToCarbRatio", slotId: "icr-2", currentValue: 10, proposedValue: 10.5, isfUnit: undefined },
      7,
      NOW,
    )
    expect(insulinTherapyService.updateIcr).toHaveBeenCalledWith("icr-2", 10.5, 7, 7, undefined, tx)
    expect(tx.autoApplyEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deltaPercent: 5 }) }),
    )
  })

  it("AUTO_APPLY (basal) → updatePumpSlot(tx)", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    await autoApplyService.applyExpertEditGoverned(
      { ...isfEdit, parameterType: "basalRate", slotId: "pump-3", currentValue: 0.8, proposedValue: 0.85, isfUnit: undefined },
      7,
      NOW,
    )
    expect(insulinTherapyService.updatePumpSlot).toHaveBeenCalledWith("pump-3", 0.85, 7, 7, undefined, tx)
  })

  it("re-évaluation sous lock bascule (course anti-cliquet) → proposition, PAS d'apply", async () => {
    // 1re éval (hors lock) = AUTO_APPLY ; re-éval (sous lock, contexte frais) = FALLBACK C7.
    evaluate.mockReturnValueOnce({ decision: "AUTO_APPLY" } as never).mockReturnValueOnce({ decision: "FALLBACK_PROPOSAL", failedCheck: "C7" } as never)
    const res = await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "C7", proposalId: "prop-1" })
    expect(insulinTherapyService.updateIsf).not.toHaveBeenCalled()
    expect(adjustmentService.createProposal).toHaveBeenCalled()
  })

  it("FALLBACK_PROPOSAL → proposition patient (reason patientRequested) + audit AUTO_APPLY_FALLBACK", async () => {
    evaluate.mockReturnValue({ decision: "FALLBACK_PROPOSAL", failedCheck: "C6b" } as never)
    const res = await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "C6b", proposalId: "prop-1" })
    expect(adjustmentService.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 7, parameterType: "insulinSensitivityFactor", reason: "patientRequested", timeSlotStartHour: 22, timeSlotEndHour: 6 }),
      { userId: 7, role: "patient" },
      undefined,
    )
    expect(insulinTherapyService.updateIsf).not.toHaveBeenCalled()
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "AUTO_APPLY_FALLBACK" }))
  })

  it("HARD_REJECT → aucune action, audit AUTO_APPLY_REJECTED ; outcome rejected", async () => {
    evaluate.mockReturnValue({ decision: "HARD_REJECT", reason: "outOfClinicalBounds" } as never)
    const res = await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(res).toEqual({ outcome: "rejected", reason: "outOfClinicalBounds" })
    expect(insulinTherapyService.updateIsf).not.toHaveBeenCalled()
    expect(adjustmentService.createProposal).not.toHaveBeenCalled()
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "AUTO_APPLY_REJECTED" }))
  })

  it("triple verrou : kill-switch global OFF → autoApply=false transmis à l'enveloppe", async () => {
    globalOn.mockReturnValue(false)
    evaluate.mockReturnValue({ decision: "FALLBACK_PROPOSAL", failedCheck: "C1" } as never)
    await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ authority: { maturityLevel: "EXPERT", autoApply: false } }))
  })

  it("triple verrou : aucune GovernanceApproval active → autoApply=false transmis à l'enveloppe", async () => {
    prismaMock.governanceApproval.count.mockResolvedValue(0 as never)
    evaluate.mockReturnValue({ decision: "FALLBACK_PROPOSAL", failedCheck: "C1" } as never)
    await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ authority: { maturityLevel: "EXPERT", autoApply: false } }))
  })

  it("échec d'apply dans la transaction → rethrow, pas d'audit AUTO_APPLIED_SETTING (rollback atomique)", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    vi.mocked(insulinTherapyService.updateIsf).mockRejectedValueOnce(new Error("isfSlotNotFound"))
    await expect(autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)).rejects.toThrow("isfSlotNotFound")
    expect(auditService.logWithTx).not.toHaveBeenCalledWith(tx, expect.objectContaining({ action: "AUTO_APPLIED_SETTING" }))
  })

  it("baseline du créneau bougé sous lock → proposition (fail-closed B1, pas d'apply)", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    // Valeur courante relue sous lock (0.6) ≠ edit.currentValue (0.5) → baselineMoved → proposition.
    tx.insulinSensitivityFactor.findFirst.mockResolvedValue({ sensitivityFactorGl: 0.6 })
    const res = await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "baselineMoved", proposalId: "prop-1" })
    expect(insulinTherapyService.updateIsf).not.toHaveBeenCalled()
  })

  it("verrou occupé (mutation concurrente) → proposition (fail-closed non bloquant)", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    tx.$queryRaw.mockResolvedValue([{ locked: false }])
    const res = await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "busy", proposalId: "prop-1" })
    expect(insulinTherapyService.updateIsf).not.toHaveBeenCalled()
  })

  it("patient absent/soft-deleted → patientNotFound", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null as never)
    await expect(autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)).rejects.toThrow("patientNotFound")
  })
})
