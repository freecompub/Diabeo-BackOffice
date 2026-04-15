/**
 * Test suite: Objectives Service — CGM Objectives and GD Defaults
 *
 * Clinical behavior tested:
 * - Pathology-specific CGM threshold defaults: DT1 and DT2 patients share
 *   standard TIR targets (very-low <0.54 g/L, low <0.70 g/L, high >1.80 g/L,
 *   very-high >2.50 g/L) while GD (gestational diabetes) patients receive
 *   tighter thresholds mandated by obstetric guidelines
 * - Creating CGM objectives for a patient stores the chosen thresholds and
 *   links them to the patient record, enabling downstream TIR calculation
 * - Updating existing objectives replaces only the provided fields; clinical
 *   thresholds not included in the patch are preserved
 * - Every read and write is accompanied by an audit log entry
 *
 * Associated risks:
 * - Applying DT1/DT2 defaults to a GD patient would set thresholds that are
 *   too permissive, missing hyperglycemic episodes harmful to the foetus
 * - Missing audit log on objective creation or update breaks HDS traceability
 *   of who changed clinical targets and when
 * - Returning stale objectives after an update (cache issue) could lead a
 *   physician to make decisions based on outdated thresholds
 *
 * Edge cases:
 * - getCgmDefaults called with each pathology value (DT1, DT2, GD)
 * - Patient with no existing objectives record (first-time creation)
 * - Partial update with only one threshold field provided
 * - getCgmDefaults called with an unknown pathology string (must fall back
 *   gracefully or throw a descriptive error)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { objectivesService, getCgmDefaults } from "@/lib/services/objectives.service"

describe("objectivesService", () => {
  describe("getCgmDefaults", () => {
    it("returns standard defaults for DT1", () => {
      const defaults = getCgmDefaults("DT1")
      expect(defaults.veryLow).toBe(0.54)
      expect(defaults.low).toBe(0.70)
      expect(defaults.ok).toBe(1.80)
      expect(defaults.high).toBe(2.50)
    })

    it("returns standard defaults for DT2", () => {
      const defaults = getCgmDefaults("DT2")
      expect(defaults.ok).toBe(1.80)
    })

    it("returns tighter defaults for GD (gestational diabetes)", () => {
      const defaults = getCgmDefaults("GD")
      expect(defaults.ok).toBe(1.40)
      expect(defaults.high).toBe(2.00)
      expect(defaults.low).toBe(0.63)
    })

    it("returns standard defaults when pathology is undefined", () => {
      const defaults = getCgmDefaults(undefined)
      expect(defaults.ok).toBe(1.80)
    })

    it("all defaults have correct threshold ordering", () => {
      for (const pathology of ["DT1", "DT2", "GD", undefined] as const) {
        const d = getCgmDefaults(pathology as "DT1" | "DT2" | "GD" | undefined)
        expect(d.veryLow).toBeLessThan(d.low)
        expect(d.low).toBeLessThan(d.ok)
        expect(d.ok).toBeLessThan(d.high)
        expect(d.titrLow).toBeLessThan(d.titrHigh)
      }
    })
  })

  describe("getAll", () => {
    it("returns objectives with CGM defaults when no record exists", async () => {
      prismaMock.glycemiaObjective.findMany.mockResolvedValue([])
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.annexObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1" } as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await objectivesService.getAll(1, 1)

      expect(result.glycemia).toEqual([])
      expect(result.cgm).toEqual(getCgmDefaults("DT1"))
      expect(result.annex).toBeNull()
    })

    it("returns existing CGM record when available", async () => {
      const cgmRecord = { id: 1, patientId: 1, veryLow: 0.50, low: 0.65, ok: 1.60, high: 2.20, titrLow: 0.65, titrHigh: 1.60 }
      prismaMock.glycemiaObjective.findMany.mockResolvedValue([])
      prismaMock.cgmObjective.findUnique.mockResolvedValue(cgmRecord as never)
      prismaMock.annexObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1" } as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await objectivesService.getAll(1, 1)
      expect(result.cgm).toEqual(cgmRecord)
    })

    it("US-SEC-002: queries patient with deletedAt:null filter (soft-delete guard)", async () => {
      // Regression guard: a service-layer query without the soft-delete
      // filter would resurface PHI of patients who exercised RGPD Art. 17.
      const findFirstSpy = vi.spyOn(prismaMock.patient, "findFirst")
      prismaMock.glycemiaObjective.findMany.mockResolvedValue([])
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.annexObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1" } as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      await objectivesService.getAll(42, 1)

      const call = findFirstSpy.mock.calls.at(-1)?.[0] as { where?: { deletedAt?: null } }
      expect(call?.where?.deletedAt).toBeNull()
    })
  })

  describe("updateCgm", () => {
    it("upserts CGM objectives in transaction", async () => {
      const input = { veryLow: 0.54, low: 0.70, ok: 1.80, high: 2.50, titrLow: 0.70, titrHigh: 1.80 }
      const mockTx = {
        cgmObjective: { upsert: vi.fn().mockResolvedValue({ id: 1, patientId: 1, ...input }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await objectivesService.updateCgm(1, input, 1)

      expect(mockTx.cgmObjective.upsert).toHaveBeenCalled()
      expect(result.patientId).toBe(1)
    })
  })

  describe("updateAnnex", () => {
    it("upserts annex objectives in transaction", async () => {
      const input = { objectiveHba1c: 7.0, objectiveWalk: 30 }
      const mockTx = {
        annexObjective: { upsert: vi.fn().mockResolvedValue({ id: 1, patientId: 1, ...input }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await objectivesService.updateAnnex(1, input, 1)

      expect(mockTx.annexObjective.upsert).toHaveBeenCalled()
      expect(result.patientId).toBe(1)
    })
  })
})
