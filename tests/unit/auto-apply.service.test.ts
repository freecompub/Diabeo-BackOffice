/**
 * US-2657 (slice C2b) — Harnais gouverné `applyExpertEditGoverned`.
 * Comportement testé : dispatch par décision (AUTO_APPLY → apply + AutoApplyEvent + audit ;
 * FALLBACK → proposition patient ; HARD_REJECT → audit sans action) ; **double verrou** (kill-switch
 * global force autoApply=false) ; patient scopé.
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
vi.mock("@/lib/services/audit.service", () => ({ auditService: { log: vi.fn() } }))

const { autoApplyService } = await import("@/lib/services/auto-apply.service")
const { isAutoApplyGloballyEnabled } = await import("@/lib/env")
const { buildEnvelopeContext } = await import("@/lib/insulin/auto-apply-context")
const { evaluateAutoApplyEnvelope } = await import("@/lib/insulin/auto-apply-envelope")
const { insulinTherapyService } = await import("@/lib/services/insulin-therapy.service")
const { adjustmentService } = await import("@/lib/services/adjustment.service")
const { auditService } = await import("@/lib/services/audit.service")

const globalOn = vi.mocked(isAutoApplyGloballyEnabled)
const buildCtx = vi.mocked(buildEnvelopeContext)
const evaluate = vi.mocked(evaluateAutoApplyEnvelope)
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

describe("autoApplyService.applyExpertEditGoverned", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalOn.mockReturnValue(true)
    prismaMock.patient.findFirst.mockResolvedValue({ maturityLevel: "EXPERT", autoApply: true } as never)
    prismaMock.ketoneThreshold.findUnique.mockResolvedValue({ moderateThreshold: 1.5 } as never)
    prismaMock.autoApplyEvent.create.mockResolvedValue({ id: 1 } as never)
    buildCtx.mockResolvedValue({
      glycemia: { glucosesGl: [], capturePercent: 80, windowDays: 14, recentKetonesMmol: [], ketoneModerateThreshold: 1.5 },
      ratchet: { hoursSinceLastAutoApply: null, cumulativeAbsPercentThisWeek: 0 },
    } as never)
  })

  it("AUTO_APPLY (ISF) → applique + AutoApplyEvent + audit ; outcome applied", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    const res = await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(res).toEqual({ outcome: "applied" })
    expect(insulinTherapyService.updateIsf).toHaveBeenCalledWith("isf-1", 0.48, 7, 7, undefined)
    expect(prismaMock.autoApplyEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ patientId: 7, parameterType: "insulinSensitivityFactor", slotKey: "22-6" }) }),
    )
    expect(adjustmentService.createProposal).not.toHaveBeenCalled()
  })

  it("AUTO_APPLY (basal) → updatePumpSlot", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    await autoApplyService.applyExpertEditGoverned(
      { ...isfEdit, parameterType: "basalRate", slotId: "pump-3", currentValue: 0.8, proposedValue: 0.85, isfUnit: undefined },
      7,
      NOW,
    )
    expect(insulinTherapyService.updatePumpSlot).toHaveBeenCalledWith("pump-3", 0.85, 7, 7, undefined)
  })

  it("FALLBACK_PROPOSAL → proposition patient (reason patientRequested) ; outcome proposal", async () => {
    evaluate.mockReturnValue({ decision: "FALLBACK_PROPOSAL", failedCheck: "C6b" } as never)
    const res = await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(res).toEqual({ outcome: "proposal", failedCheck: "C6b", proposalId: "prop-1" })
    expect(adjustmentService.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 7, parameterType: "insulinSensitivityFactor", reason: "patientRequested", timeSlotStartHour: 22, timeSlotEndHour: 6 }),
      { userId: 7, role: "patient" },
      undefined,
    )
    expect(insulinTherapyService.updateIsf).not.toHaveBeenCalled()
    expect(prismaMock.autoApplyEvent.create).not.toHaveBeenCalled()
  })

  it("HARD_REJECT → aucune action, audit rejet ; outcome rejected", async () => {
    evaluate.mockReturnValue({ decision: "HARD_REJECT", reason: "outOfClinicalBounds" } as never)
    const res = await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)
    expect(res).toEqual({ outcome: "rejected", reason: "outOfClinicalBounds" })
    expect(insulinTherapyService.updateIsf).not.toHaveBeenCalled()
    expect(adjustmentService.createProposal).not.toHaveBeenCalled()
    expect(prismaMock.autoApplyEvent.create).not.toHaveBeenCalled()
  })

  it("double verrou : kill-switch global OFF → autoApply=false transmis à l'enveloppe", async () => {
    globalOn.mockReturnValue(false)
    evaluate.mockReturnValue({ decision: "FALLBACK_PROPOSAL", failedCheck: "C1" } as never)
    await autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW) // patient.autoApply = true
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ authority: { maturityLevel: "EXPERT", autoApply: false } }),
    )
  })

  it("AUTO_APPLY (ICR) → updateIcr ; deltaPercent correct + audit décision 'applied'", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    await autoApplyService.applyExpertEditGoverned(
      { ...isfEdit, parameterType: "insulinToCarbRatio", slotId: "icr-2", currentValue: 10, proposedValue: 10.5, isfUnit: undefined },
      7,
      NOW,
    )
    expect(insulinTherapyService.updateIcr).toHaveBeenCalledWith("icr-2", 10.5, 7, 7, undefined)
    // deltaPercent = |(10.5-10)/10|*100 = 5
    expect(prismaMock.autoApplyEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deltaPercent: 5 }) }),
    )
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ kind: "autoApplyDecision", outcome: "applied" }) }),
    )
  })

  it("échec d'apply : AutoApplyEvent déjà écrit (avant) + audit 'applyFailed' + rethrow", async () => {
    evaluate.mockReturnValue({ decision: "AUTO_APPLY" } as never)
    vi.mocked(insulinTherapyService.updateIsf).mockRejectedValueOnce(new Error("isfSlotNotFound"))
    await expect(autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)).rejects.toThrow("isfSlotNotFound")
    expect(prismaMock.autoApplyEvent.create).toHaveBeenCalled() // écrit AVANT l'apply (sur-comptage fail-safe)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ outcome: "applyFailed" }) }),
    )
  })

  it("patient absent/soft-deleted → patientNotFound", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null as never)
    await expect(autoApplyService.applyExpertEditGoverned(isfEdit, 7, NOW)).rejects.toThrow("patientNotFound")
  })
})
