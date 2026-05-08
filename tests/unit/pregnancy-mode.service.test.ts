/**
 * Test suite: Pregnancy Mode Service (US-2232)
 *
 * Clinical behavior tested:
 * - Toggling pregnancy mode ON applies tighter GD CGM thresholds (ACOG/ADA
 *   targets), even on a Type 1 patient — protects fetus from hyperglycemia.
 * - Toggling OFF restores baseline thresholds for the patient's pathology.
 *   For an existing GD patient, GD defaults are kept (toggle is independent).
 * - No-op when the requested state matches current state — avoids spurious
 *   audit entries and reduces churn.
 * - Audit log captures both old & new values for HDS forensics.
 *
 * Associated risks:
 * - Forgetting to update CgmObjective on toggle would leave permissive
 *   thresholds active during pregnancy and miss hyperglycemic excursions.
 * - Mass-rollback to baseline on accidental toggle-off should be visible
 *   in audit (oldValue / newValue captured).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { pregnancyModeService } from "@/lib/services/pregnancy-mode.service"

describe("pregnancyModeService.setMode", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects unknown patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(
      pregnancyModeService.setMode(999, true, 1),
    ).rejects.toThrow("patient_not_found")
  })

  it("returns no-op result when state already matches", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1, pregnancyMode: true, pathology: "GD",
    } as never)

    const result = await pregnancyModeService.setMode(1, true, 99)
    expect(result.thresholdsAdapted).toBe(false)
    // Transaction should NOT have been called (no DB changes)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("applies GD thresholds when enabling on a DT1 patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1, pregnancyMode: false, pathology: "DT1",
    } as never)
    prismaMock.cgmObjective.findUnique.mockResolvedValue(null as never)

    const upsertSpy = vi.fn().mockResolvedValue({})
    const updateSpy = vi.fn().mockResolvedValue({})
    const mockTx = {
      patient: { update: updateSpy },
      cgmObjective: { upsert: upsertSpy },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

    await pregnancyModeService.setMode(1, true, 99)

    expect(updateSpy).toHaveBeenCalled()
    const cgmCall = upsertSpy.mock.calls[0]?.[0] as { create?: { ok?: number; high?: number } }
    // GD defaults: ok=1.40, high=2.00 (stricter than DT1 1.80/2.50)
    expect(cgmCall.create?.ok).toBe(1.40)
    expect(cgmCall.create?.high).toBe(2.00)
  })

  it("restores standard thresholds when disabling on a DT1 patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1, pregnancyMode: true, pathology: "DT1",
    } as never)
    prismaMock.patientPregnancy.findFirst.mockResolvedValue(null as never)
    prismaMock.cgmObjective.findUnique.mockResolvedValue(null as never)

    const upsertSpy = vi.fn().mockResolvedValue({})
    const mockTx = {
      patient: { update: vi.fn().mockResolvedValue({}) },
      cgmObjective: { upsert: upsertSpy },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

    await pregnancyModeService.setMode(1, false, 99)

    const cgmCall = upsertSpy.mock.calls[0]?.[0] as { create?: { ok?: number; high?: number } }
    expect(cgmCall.create?.ok).toBe(1.80)
    expect(cgmCall.create?.high).toBe(2.50)
  })

  it("toggle-OFF on GD pathology is no-op for thresholds (audit honest)", async () => {
    // GD pathology pins thresholds to GD defaults — toggling pregnancyMode off
    // must NOT widen them. Audit must reflect thresholdsAdapted=false.
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1, pregnancyMode: true, pathology: "GD",
    } as never)
    prismaMock.patientPregnancy.findFirst.mockResolvedValue(null as never)
    prismaMock.cgmObjective.findUnique.mockResolvedValue({
      veryLow: { toNumber: () => 0.60 },
      low: { toNumber: () => 0.63 },
      ok: { toNumber: () => 1.40 },
      high: { toNumber: () => 2.00 },
      titrLow: { toNumber: () => 0.63 },
      titrHigh: { toNumber: () => 1.40 },
    } as never)

    const upsertSpy = vi.fn().mockResolvedValue({})
    const auditSpy = vi.fn().mockResolvedValue({})
    const mockTx = {
      patient: { update: vi.fn().mockResolvedValue({}) },
      cgmObjective: { upsert: upsertSpy },
      auditLog: { create: auditSpy },
    }
    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

    const result = await pregnancyModeService.setMode(1, false, 42)
    expect(result.thresholdsAdapted).toBe(false)
    expect(upsertSpy).not.toHaveBeenCalled()
    const auditCall = auditSpy.mock.calls[0]?.[0] as {
      data?: { metadata?: { thresholdsAdapted?: boolean; pinnedTo?: string } }
    }
    expect(auditCall.data?.metadata?.thresholdsAdapted).toBe(false)
    expect(auditCall.data?.metadata?.pinnedTo).toBe("GD")
  })

  it("blocks toggle-OFF when patient has an active PatientPregnancy", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1, pregnancyMode: true, pathology: "DT1",
    } as never)
    prismaMock.patientPregnancy.findFirst.mockResolvedValue({ id: 99 } as never)

    await expect(
      pregnancyModeService.setMode(1, false, 42),
    ).rejects.toThrow("active_pregnancy_blocks_toggle_off")
  })

  it("rejects forceOverride without justification reason (≥ 20 chars)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1, pregnancyMode: true, pathology: "DT1",
    } as never)
    prismaMock.patientPregnancy.findFirst.mockResolvedValue({ id: 99 } as never)

    await expect(
      pregnancyModeService.setMode(1, false, 42, undefined, {
        forceOverride: true,
        forceOverrideReason: "too short",
      }),
    ).rejects.toThrow("force_override_reason_required")
  })

  it("allows toggle-OFF with forceOverride + valid reason and tags audit", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1, pregnancyMode: true, pathology: "DT1",
    } as never)
    prismaMock.patientPregnancy.findFirst.mockResolvedValue({ id: 99 } as never)
    prismaMock.cgmObjective.findUnique.mockResolvedValue(null as never)

    const auditSpy = vi.fn().mockResolvedValue({})
    const mockTx = {
      patient: { update: vi.fn().mockResolvedValue({}) },
      cgmObjective: { upsert: vi.fn().mockResolvedValue({}) },
      auditLog: { create: auditSpy },
    }
    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

    const result = await pregnancyModeService.setMode(1, false, 42, undefined, {
      forceOverride: true,
      forceOverrideReason: "patient delivered last week, ending pregnancy mode per Dr X",
    })
    expect(result.thresholdsAdapted).toBe(true)
    const auditCall = auditSpy.mock.calls[0]?.[0] as {
      data?: { metadata?: { forceOverride?: boolean; forceOverrideReason?: string } }
    }
    expect(auditCall.data?.metadata?.forceOverride).toBe(true)
    // Reason is encrypted in audit metadata — verify encrypted blob present
    expect(auditCall.data?.metadata?.forceOverrideReason).toBeDefined()
    expect(auditCall.data?.metadata?.forceOverrideReason).not.toContain("delivered")
  })

  it("audit log captures oldValue & newValue (HDS forensics)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1, pregnancyMode: false, pathology: "DT1",
    } as never)
    prismaMock.cgmObjective.findUnique.mockResolvedValue(null as never)

    const auditSpy = vi.fn().mockResolvedValue({})
    const mockTx = {
      patient: { update: vi.fn().mockResolvedValue({}) },
      cgmObjective: { upsert: vi.fn().mockResolvedValue({}) },
      auditLog: { create: auditSpy },
    }
    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

    await pregnancyModeService.setMode(1, true, 99)

    const auditCall = auditSpy.mock.calls[0]?.[0] as {
      data?: { oldValue?: { pregnancyMode?: boolean }; newValue?: { pregnancyMode?: boolean } }
    }
    expect(auditCall.data?.oldValue?.pregnancyMode).toBe(false)
    expect(auditCall.data?.newValue?.pregnancyMode).toBe(true)
  })
})
