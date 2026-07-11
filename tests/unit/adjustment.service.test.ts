/**
 * Test suite: Adjustment Service — Proposal Accept / Reject Workflow
 *
 * Clinical behavior tested:
 * - Summary query: counts of AdjustmentProposal records by status (pending,
 *   accepted, rejected, expired) for a patient, giving a physician a quick
 *   overview of outstanding recommendations
 * - Accept workflow: a DOCTOR transitions a proposal from "pending" to
 *   "accepted", records their user ID in reviewedBy, timestamps the review,
 *   and triggers the corresponding InsulinTherapySettings mutation in a single
 *   Prisma transaction — ensuring the accepted value is applied atomically
 * - Reject workflow: a DOCTOR transitions a proposal to "rejected" with an
 *   optional rejection comment; the underlying settings are NOT modified
 * - Authorization enforcement: only a user with the DOCTOR role may accept or
 *   reject proposals; NURSE and VIEWER calls must be rejected with 403
 * - Audit logging of accept and reject decisions with the reviewing doctor's
 *   identity
 *
 * Associated risks:
 * - Accepting a proposal without applying it to InsulinTherapySettings would
 *   display "accepted" in the UI while the actual parameter remains unchanged,
 *   creating a silent clinical discrepancy
 * - A non-atomic accept (proposal update succeeds, settings update fails)
 *   would leave the system in an inconsistent state
 * - A NURSE or VIEWER successfully accepting a proposal bypasses the mandatory
 *   physician validation step required by the medical device workflow (ADR #13)
 * - Missing audit on accept/reject removes the evidence trail required for
 *   HDS inspection and liability purposes
 *
 * Edge cases:
 * - Proposal already in "accepted" status being accepted again (idempotency or
 *   error depending on business rule)
 * - Proposal in "expired" status being acted on (must be rejected by the service)
 * - Accept with a proposed value exactly at a CLINICAL_BOUNDS limit
 * - Summary for a patient with zero proposals (all counts must be 0, total = 0)
 * - Reject without a comment (optional field — must not fail validation)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

// US-2651 — createManual/createProposal appellent resolveTreatmentMode (garde MDR nonInsulin).
// Patient insuliné par défaut ici pour ne pas bloquer les cas nominaux.
vi.mock("@/lib/services/treatment-mode.service", () => ({
  treatmentModeService: { resolveTreatmentMode: vi.fn(async () => ({ mode: "basalBolus", coherent: true })) },
}))

import { adjustmentService } from "@/lib/services/adjustment.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"

describe("adjustmentService", () => {
  describe("summary", () => {
    it("returns counts by status", async () => {
      prismaMock.adjustmentProposal.count
        .mockResolvedValueOnce(3)  // pending
        .mockResolvedValueOnce(10) // accepted
        .mockResolvedValueOnce(2)  // rejected
        .mockResolvedValueOnce(1)  // expired

      const result = await adjustmentService.summary(1)
      expect(result).toEqual({ pending: 3, accepted: 10, rejected: 2, expired: 1, total: 16 })
    })
  })

  describe("accept", () => {
    it("accepts a pending proposal", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor",
            proposedValue: 0.55, timeSlotStartHour: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p1", 2, true)
      expect(result.accepted).toBe(true)
      expect(result.applied).toBe(true)
      expect(mockTx.insulinSensitivityFactor.updateMany).toHaveBeenCalled()
    })

    // US-2652 — dose fixe câblée : l'accept écrit la FixedDoseSlot ciblée par `moment` (scopée patient).
    it("accepts a fixedDose proposal → writes the FixedDoseSlot by moment", async () => {
      prismaMock.fixedDoseSlot.findFirst.mockResolvedValue({ valueU: 10 } as never) // live = snapshot (pas de dérive)
      const updateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "fixedDose", proposedValue: 12, currentValue: 10, moment: "morning",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        fixedDoseSlot: { updateMany },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p1", 2, true)
      expect(result.applied).toBe(true)
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ moment: "morning", patientInsulin: { patientId: 1 } }),
          data: { valueU: 12 },
        }),
      )
    })

    // US-2652 (fix revue) — le CAS baselineMoved DOIT s'appliquer à la dose fixe (avant : inactif car
    // `moment` non forwardé → resolveCurrentValue levait slotRequired → CAS sauté → dose périmée écrite).
    it("throws 'baselineMoved' for fixedDose when the live dose drifted since the proposal", async () => {
      prismaMock.fixedDoseSlot.findFirst.mockResolvedValue({ valueU: 8 } as never) // live 8 ≠ snapshot 10
      const updateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "fixedDose", proposedValue: 12, currentValue: 10, moment: "morning",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        fixedDoseSlot: { updateMany },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, true)).rejects.toThrow("baselineMoved")
      expect(updateMany).not.toHaveBeenCalled() // rollback → dose jamais écrite sur une base déplacée
    })

    // US-2649b — compare-and-swap : la base a bougé depuis la proposition → refuser (fail-closed).
    it("throws 'baselineMoved' and applies nothing when the live slot moved since the proposal", async () => {
      // Valeur LIVE (0.99) ≠ snapshot currentValue (0.5) → sur-correction refusée.
      prismaMock.insulinSensitivityFactor.findFirst.mockResolvedValue({ sensitivityFactorGl: 0.99 } as never)
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor",
            proposedValue: 0.55, currentValue: 0.5, timeSlotStartHour: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, true)).rejects.toThrow("baselineMoved")
      // Rollback → le paramètre n'est JAMAIS écrit sur une base déplacée.
      expect(mockTx.insulinSensitivityFactor.updateMany).not.toHaveBeenCalled()
    })

    it("throws for non-pending proposal", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({ id: "p1", status: "accepted" }),
        },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, false))
        .rejects.toThrow("proposalNotFound")
    })

    // A4 — sécurité : applyImmediately=true avec une valeur hors bornes cliniques
    // (ISF 5.0 > ISF_GL_MAX 1.00) doit lever `valueOutOfBounds` (string mappée en
    // 400 par la route) AVANT d'appliquer le paramètre, et le throw dans la
    // transaction garantit le rollback du statut (proposition reste `pending`).
    it("throws 'valueOutOfBounds' and applies nothing when the value is out of clinical bounds", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor",
            proposedValue: 5.0, timeSlotStartHour: 8, // 5.0 g/L/U > ISF_GL_MAX (1.00)
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      // Le contrat exact de la chaîne d'erreur (consommée par la route → 400).
      await expect(adjustmentService.accept("p1", 2, true))
        .rejects.toThrow("valueOutOfBounds")
      // Le paramètre insuline n'est JAMAIS appliqué (validation avant updateMany).
      expect(mockTx.insulinSensitivityFactor.updateMany).not.toHaveBeenCalled()
    })

    it("applies a basal proposal via a pump slot SCOPED to the patient (anti-IDOR)", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "basalRate", proposedValue: 0.95, pumpBasalSlotId: "slot1",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        pumpBasalSlot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p1", 2, true)
      expect(result.applied).toBe(true)
      expect(mockTx.pumpBasalSlot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "slot1", basalConfig: { settings: { patientId: 1 } } }),
        }),
      )
    })

    it("throws 'isfSlotNotFound' when the ISF slot vanished between propose and accept (no phantom accept)", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor", proposedValue: 0.55, timeSlotStartHour: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, true)).rejects.toThrow("isfSlotNotFound")
    })

    it("throws 'pumpSlotNotFound' when the scoped basal slot matches nothing (fail-closed)", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "basalRate", proposedValue: 0.95, pumpBasalSlotId: "slotX",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        pumpBasalSlot: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, true)).rejects.toThrow("pumpSlotNotFound")
    })
  })

  describe("reject", () => {
    it("rejects a pending proposal", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({ id: "p1", status: "pending" }),
          update: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.reject("p1", 2)
      expect(result.rejected).toBe(true)
    })
  })

  describe("list", () => {
    it("lists proposals with filters", async () => {
      prismaMock.adjustmentProposal.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await adjustmentService.list(1, {
        status: "pending",
        parameterType: "insulinSensitivityFactor",
        from: new Date("2026-01-01"),
        to: new Date("2026-03-31"),
      }, 1)
      expect(result).toEqual([])
    })

    it("lists without filters", async () => {
      prismaMock.adjustmentProposal.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await adjustmentService.list(1, {}, 1)
      expect(result).toEqual([])
    })
  })

  describe("createManual", () => {
    it("creates manual proposal in transaction", async () => {
      const mockTx = {
        adjustmentProposal: { create: vi.fn().mockResolvedValue({ id: "p1", status: "pending" }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.createManual({
        patientId: 1,
        parameterType: "insulinSensitivityFactor",
        currentValue: 0.5,
        proposedValue: 0.55,
        changePercent: 10,
        confidence: "high",
        reason: "isfTooLow",
        supportingEvents: 12,
      } as any, 2)

      expect(result.id).toBe("p1")
    })

    // US-2651 — la frontière MDR s'applique AUSSI à cette 2ᵉ primitive de création.
    it("patient nonInsulin → nonInsulinNoDose, aucune écriture", async () => {
      const { treatmentModeService } = await import("@/lib/services/treatment-mode.service")
      vi.mocked(treatmentModeService.resolveTreatmentMode).mockResolvedValueOnce({ mode: "nonInsulin", coherent: true })
      const tx = { adjustmentProposal: { create: vi.fn() }, auditLog: { create: vi.fn() } }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(tx)) as any)

      await expect(
        adjustmentService.createManual({ patientId: 1, parameterType: "insulinSensitivityFactor" } as any, 2),
      ).rejects.toThrow("nonInsulinNoDose")
      expect(tx.adjustmentProposal.create).not.toHaveBeenCalled()
    })
  })

  describe("accept with ICR apply", () => {
    it("applies ICR change when applyImmediately", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p2", patientId: 1, status: "pending",
            parameterType: "insulinToCarbRatio",
            proposedValue: 12.0, carbRatioSlotStart: 12,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        carbRatio: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p2", 2, true)
      expect(result.applied).toBe(true)
      expect(mockTx.carbRatio.updateMany).toHaveBeenCalled()
    })
  })

  describe("accept with basal apply", () => {
    it("applies basal rate change when applyImmediately", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p3", patientId: 1, status: "pending",
            parameterType: "basalRate",
            proposedValue: 0.85, pumpBasalSlotId: "slot-1",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        pumpBasalSlot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p3", 2, true)
      expect(result.applied).toBe(true)
      expect(mockTx.pumpBasalSlot.updateMany).toHaveBeenCalled()
    })
  })

  // US-2660 — ÉCRITURE GROUPÉE de la basale STYLO (MDI) à l'acceptation médecin.
  // Remplace l'ancien fail-closed `styloBasalApplyNotSupported` (US-2659 différait l'écriture).
  describe("accept with basal STYLO apply (US-2660)", () => {
    const styloProposal = (id: string, over: Record<string, unknown> = {}) => ({
      id, patientId: 1, status: "pending",
      parameterType: "basalRate", proposedValue: 20, currentValue: 18,
      basalDoseKind: "daily", pumpBasalSlotId: null,
      ...over,
    })

    it("applyImmediately d'une STYLO 'daily' → écrit BasalConfiguration.dailyDose (scopé patient, CAS atomique) + audite", async () => {
      // live = snapshot (18) → compare-and-swap OK.
      prismaMock.basalConfiguration.findFirst.mockResolvedValue({ dailyDose: 18, morningDose: null, eveningDose: null } as never)
      const updateMany = vi.fn().mockResolvedValue({ count: 1 })
      const auditCreate = vi.fn().mockResolvedValue({})
      const mockTx = {
        adjustmentProposal: { findUnique: vi.fn().mockResolvedValue(styloProposal("p5")), update: vi.fn().mockResolvedValue({}) },
        basalConfiguration: { updateMany },
        auditLog: { create: auditCreate },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p5", 2, true)
      expect(result.applied).toBe(true)
      // Colonne ciblée = dailyDose ; scopée patient ; WHERE verrouille la valeur attendue (CAS atomique DB).
      expect(updateMany).toHaveBeenCalledWith({
        where: { settings: { patientId: 1 }, dailyDose: 18 },
        data: { dailyDose: 20 },
      })
      // US-2660 (HDS) — l'accept stylo appliqué est audité (PROPOSAL_ACCEPTED) SANS dose en clair.
      expect(auditCreate).toHaveBeenCalledTimes(1)
      const auditArg = JSON.stringify(auditCreate.mock.calls[0]?.[0])
      expect(auditArg).toContain("PROPOSAL_ACCEPTED")
      expect(auditArg).not.toContain("20") // la dose proposée (20 U) ne fuit jamais dans l'audit
    })

    it("STYLO 'morning' / 'evening' → cible la colonne correspondante (morningDose / eveningDose)", async () => {
      const run = async (kind: "morning" | "evening", column: string, live: Record<string, unknown>) => {
        prismaMock.basalConfiguration.findFirst.mockResolvedValue(live as never)
        const updateMany = vi.fn().mockResolvedValue({ count: 1 })
        const mockTx = {
          adjustmentProposal: { findUnique: vi.fn().mockResolvedValue(styloProposal("p", { basalDoseKind: kind })), update: vi.fn().mockResolvedValue({}) },
          basalConfiguration: { updateMany },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }
        prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
        await adjustmentService.accept("p", 2, true)
        expect(updateMany).toHaveBeenCalledWith({
          where: { settings: { patientId: 1 }, [column]: 18 },
          data: { [column]: 20 },
        })
      }
      await run("morning", "morningDose", { dailyDose: null, morningDose: 18, eveningDose: 12 })
      await run("evening", "eveningDose", { dailyDose: null, morningDose: 18, eveningDose: 18 })
    })

    it("dose ciblée effacée depuis la proposition (count 0) → styloBasalNotFound, rollback (jamais d'écriture fantôme)", async () => {
      // La dose 'daily' a été mise à NULL depuis → liveCurrentValue = null (guard baselineMoved inactif),
      // mais le WHERE `{ dailyDose: 18 }` matche 0 ligne (NULL ≠ 18) → fail-closed.
      prismaMock.basalConfiguration.findFirst.mockResolvedValue({ dailyDose: null, morningDose: null, eveningDose: null } as never)
      const mockTx = {
        adjustmentProposal: { findUnique: vi.fn().mockResolvedValue(styloProposal("p7")), update: vi.fn().mockResolvedValue({}) },
        basalConfiguration: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(adjustmentService.accept("p7", 2, true)).rejects.toThrow("styloBasalNotFound")
    })

    it("BasalConfiguration absente (config disparue) → styloBasalNotFound, rollback", async () => {
      // findFirst null → resolveCurrentValue lève currentValueNotFound → liveCurrentValue null → CAS
      // inactif, mais l'updateMany matche 0 ligne → fail-closed (même chemin que dose effacée).
      prismaMock.basalConfiguration.findFirst.mockResolvedValue(null as never)
      const mockTx = {
        adjustmentProposal: { findUnique: vi.fn().mockResolvedValue(styloProposal("p9")), update: vi.fn().mockResolvedValue({}) },
        basalConfiguration: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(adjustmentService.accept("p9", 2, true)).rejects.toThrow("styloBasalNotFound")
    })

    it("dose STYLO hors bornes cliniques à l'accept (< MDI_BASAL_MIN_U) → valueOutOfBounds, aucune lecture/écriture", async () => {
      // Re-validation des bornes STYLO AVANT toute lecture : une dose sous le plancher est refusée
      // même si elle avait passé la création. 0,2 U < MDI_BASAL_MIN_U (0,5 U).
      const updateMany = vi.fn()
      const mockTx = {
        adjustmentProposal: { findUnique: vi.fn().mockResolvedValue(styloProposal("p10", { proposedValue: 0.2 })), update: vi.fn().mockResolvedValue({}) },
        basalConfiguration: { updateMany },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(adjustmentService.accept("p10", 2, true)).rejects.toThrow("valueOutOfBounds")
      expect(updateMany).not.toHaveBeenCalled()
    })

    it("dose STYLO live dérivée depuis la proposition (live ≠ snapshot) → baselineMoved, aucune écriture", async () => {
      // snapshot currentValue = 18, mais live = 22 (le médecin a ajusté la dose entre-temps).
      prismaMock.basalConfiguration.findFirst.mockResolvedValue({ dailyDose: 22, morningDose: null, eveningDose: null } as never)
      const updateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockTx = {
        adjustmentProposal: { findUnique: vi.fn().mockResolvedValue(styloProposal("p8")), update: vi.fn().mockResolvedValue({}) },
        basalConfiguration: { updateMany },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(adjustmentService.accept("p8", 2, true)).rejects.toThrow("baselineMoved")
      expect(updateMany).not.toHaveBeenCalled()
    })

    it("accept SANS apply d'une proposition STYLO → accepté (statut), non appliqué (aucune écriture)", async () => {
      const mockTx = {
        adjustmentProposal: { findUnique: vi.fn().mockResolvedValue(styloProposal("p6")), update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      const result = await adjustmentService.accept("p6", 2, false)
      expect(result.accepted).toBe(true)
      expect(result.applied).toBe(false)
    })

    // US-2660 (code-review MED) — filet fail-closed : apply demandé sans cible résoluble.
    it("applyImmediately sans discriminateur de créneau résoluble → noApplicableApplyTarget (jamais applied fantôme)", async () => {
      // ISF sans timeSlotStartHour : passe validateProposedValue (bornes ISF), liveCurrentValue null
      // (slotRequired → CAS sauté), mais AUCUNE branche d'apply ne matche → else fail-closed.
      const updateMany = vi.fn()
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p11", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor", proposedValue: 0.5, currentValue: 0.5, timeSlotStartHour: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(adjustmentService.accept("p11", 2, true)).rejects.toThrow("noApplicableApplyTarget")
      expect(updateMany).not.toHaveBeenCalled()
    })

    // US-2660 (medical INFO, durcissement) — invariant d'exclusivité de la cible basale.
    it("basalRate portant À LA FOIS pumpBasalSlotId ET basalDoseKind → basalTargetAmbiguous, aucune écriture", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue(styloProposal("p12", { pumpBasalSlotId: "slot1" })),
          update: vi.fn().mockResolvedValue({}),
        },
        basalConfiguration: { updateMany: vi.fn() },
        pumpBasalSlot: { updateMany: vi.fn() },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(adjustmentService.accept("p12", 2, true)).rejects.toThrow("basalTargetAmbiguous")
    })
  })

  describe("accept without apply", () => {
    it("accepts without applying changes", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p4", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor",
            proposedValue: 0.55, timeSlotStartHour: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p4", 2, false)
      expect(result.accepted).toBe(true)
      expect(result.applied).toBe(false)
    })
  })

  describe("createEngineProposal (US-2651 moteur)", () => {
    it("crée une proposition ALGORITHM : source algorithm, userId null, métriques non nulles, currentValue re-dérivé", async () => {
      // currentValue re-lu serveur (ISF 0.5) ≠ du candidat ; changePercent recalculé (0.55 vs 0.5 = +10 %).
      prismaMock.insulinSensitivityFactor.findFirst.mockResolvedValue({ sensitivityFactorGl: 0.5 } as never)
      prismaMock.adjustmentProposal.findFirst.mockResolvedValue(null) // pas de pending
      const mockTx = {
        adjustmentProposal: { create: vi.fn().mockResolvedValue({ id: "e1", status: "pending", proposedByUserId: null }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const res = await adjustmentService.createEngineProposal({
        patientId: 1, parameterType: "insulinSensitivityFactor", proposedValue: 0.55,
        expectedCurrentValue: 0.5, reason: "isfTooLow", confidence: "high", supportingEvents: 12,
        totalEventsConsidered: 12, timeSlotStartHour: 8, timeSlotEndHour: 12,
      })

      expect(res.id).toBe("e1")
      const data = mockTx.adjustmentProposal.create.mock.calls[0]![0].data
      expect(data.source).toBe("algorithm")
      expect(data.proposedByUserId).toBeNull()
      expect(data.confidence).toBe("high")
      expect(data.supportingEvents).toBe(12)
      expect(Number(data.currentValue)).toBe(0.5) // serveur, pas le candidat
      expect(Number(data.changePercent)).toBeCloseTo(10)
      // Audit moteur sans PHI (userId null, pas de dose).
      expect(mockTx.auditLog.create).toHaveBeenCalled()
    })

    it("patient nonInsulin → nonInsulinNoDose (frontière MDR)", async () => {
      const { treatmentModeService } = await import("@/lib/services/treatment-mode.service")
      vi.mocked(treatmentModeService.resolveTreatmentMode).mockResolvedValueOnce({ mode: "nonInsulin", coherent: true })
      await expect(
        adjustmentService.createEngineProposal({
          patientId: 1, parameterType: "insulinSensitivityFactor", proposedValue: 0.55,
          expectedCurrentValue: 0.5, reason: "isfTooLow", confidence: "high", supportingEvents: 12,
          timeSlotStartHour: 8, timeSlotEndHour: 12,
        }),
      ).rejects.toThrow("nonInsulinNoDose")
    })

    const isfInput = (over: Record<string, unknown>) => ({
      patientId: 1, parameterType: "insulinSensitivityFactor" as const, proposedValue: 0.55,
      expectedCurrentValue: 0.5, reason: "isfTooLow" as const, confidence: "high" as const,
      supportingEvents: 12, timeSlotStartHour: 8, timeSlotEndHour: 12, ...over,
    })

    it("config dérivée depuis l'analyse (live ≠ expected) → baselineMovedAtPersist", async () => {
      prismaMock.insulinSensitivityFactor.findFirst.mockResolvedValue({ sensitivityFactorGl: 0.5 } as never)
      // candidat calculé sur 0.4, mais la config live est 0.5 → rejet (re-analyse au prochain run).
      await expect(adjustmentService.createEngineProposal(isfInput({ expectedCurrentValue: 0.4 })))
        .rejects.toThrow("baselineMovedAtPersist")
    })

    it("reason ↔ direction incohérents (isfTooLow mais baisse) → reasonDirectionMismatch", async () => {
      prismaMock.insulinSensitivityFactor.findFirst.mockResolvedValue({ sensitivityFactorGl: 0.5 } as never)
      // isfTooLow (hausse attendue) mais proposedValue 0.45 < 0.5 → mismatch.
      await expect(adjustmentService.createEngineProposal(isfInput({ proposedValue: 0.45 })))
        .rejects.toThrow("reasonDirectionMismatch")
    })

    it("supportingEvents ≤ 0 → invalidSupportingEvents", async () => {
      await expect(adjustmentService.createEngineProposal(isfInput({ supportingEvents: 0 })))
        .rejects.toThrow("invalidSupportingEvents")
    })

    it("US-2659 — proposition STYLO daily : lit BasalConfiguration.dailyDose + bornes MDI (U totales), pas les bornes pompe", async () => {
      prismaMock.basalConfiguration.findFirst.mockResolvedValue({ dailyDose: 22, morningDose: null, eveningDose: null } as never)
      prismaMock.adjustmentProposal.findFirst.mockResolvedValue(null)
      const mockTx = {
        adjustmentProposal: { create: vi.fn().mockResolvedValue({ id: "e2", status: "pending", proposedByUserId: null }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      // 20 U : REJETÉ par les bornes pompe (> BASAL_MAX 5 U/h) mais valide en stylo (U totales, délivrable).
      const res = await adjustmentService.createEngineProposal({
        patientId: 1, parameterType: "basalRate", proposedValue: 20,
        expectedCurrentValue: 22, reason: "basalTooHigh", confidence: "medium", supportingEvents: 5,
        basalDoseKind: "daily", analysisPeriod: "7d",
      })
      expect(res.id).toBe("e2")
      const data = mockTx.adjustmentProposal.create.mock.calls[0]![0].data
      expect(data.basalDoseKind).toBe("daily")
      expect(data.pumpBasalSlotId).toBeNull() // exclusivité : jamais un créneau pompe sur une cible stylo
      expect(Number(data.currentValue)).toBe(22) // lu serveur depuis dailyDose
    })

    it("US-2659 — proposition STYLO non délivrable (20,3 U, pas multiple de 0,5) → valueOutOfBounds", async () => {
      await expect(adjustmentService.createEngineProposal({
        patientId: 1, parameterType: "basalRate", proposedValue: 20.3,
        expectedCurrentValue: 22, reason: "basalTooHigh", confidence: "medium", supportingEvents: 5,
        basalDoseKind: "daily",
      })).rejects.toThrow("valueOutOfBounds")
    })
  })

  describe("createProposal — BAISSE basale PATIENT (US-2659 S3)", () => {
    const patient = { userId: 42, role: "patient" as const }
    // Mocke la config basale (mode + dose) + maturité + absence de cooldown/pending. `configType`/dose
    // partagent le même `basalConfiguration.findFirst` (resolveCurrentValue + E1).
    const setup = (opts: { maturity: string; configType: string; dose?: number }) => {
      vi.mocked(treatmentModeService.resolveTreatmentMode).mockResolvedValue({ mode: "basalBolus", coherent: true, maturityLevel: opts.maturity } as never)
      prismaMock.basalConfiguration.findFirst.mockResolvedValue({
        dailyDose: opts.dose ?? 22, morningDose: null, eveningDose: null, configType: opts.configType,
      } as never)
      prismaMock.pumpBasalSlot.findFirst.mockResolvedValue({ rate: opts.dose ?? 0.8 } as never)
      prismaMock.adjustmentProposal.findFirst.mockResolvedValue(null) // ni cooldown ni pending
      const create = vi.fn().mockResolvedValue({ id: "d1", status: "pending", proposerComment: null })
      const auditCreate = vi.fn().mockResolvedValue({})
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb({ adjustmentProposal: { create }, auditLog: { create: auditCreate } })) as any)
      return { create, auditCreate }
    }

    it("STYLO CONFIRME + accusé DKA + amplitude OK → proposition créée, accusé persisté (timestamp)", async () => {
      const { create } = setup({ maturity: "CONFIRME", configType: "single_injection", dose: 22 })
      const res = await adjustmentService.createProposal(
        { patientId: 1, parameterType: "basalRate", proposedValue: 20, reason: "patientRequested", basalDoseKind: "daily", sickDayAcknowledged: true },
        patient,
      )
      expect(res.id).toBe("d1")
      const data = create.mock.calls[0]![0].data
      expect(data.sickDayAcknowledgedAt).toBeInstanceOf(Date) // consentement DKA persisté (immuable)
      expect(Number(data.currentValue)).toBe(22) // lu serveur (dailyDose)
    })

    it("STYLO sans accusé DKA → dkaAcknowledgmentRequired", async () => {
      setup({ maturity: "CONFIRME", configType: "single_injection" })
      await expect(adjustmentService.createProposal(
        { patientId: 1, parameterType: "basalRate", proposedValue: 20, reason: "patientRequested", basalDoseKind: "daily" },
        patient,
      )).rejects.toThrow("dkaAcknowledgmentRequired")
    })

    it("STYLO INTERMEDIATE (pas CONFIRME) → maturityTooLowForDecrease", async () => {
      setup({ maturity: "INTERMEDIATE", configType: "single_injection" })
      await expect(adjustmentService.createProposal(
        { patientId: 1, parameterType: "basalRate", proposedValue: 20, reason: "patientRequested", basalDoseKind: "daily", sickDayAcknowledged: true },
        patient,
      )).rejects.toThrow("maturityTooLowForDecrease")
    })

    it("POMPE INTERMEDIATE + baisse ≤ 10 % → créée (pas d'accusé DKA requis)", async () => {
      const { create } = setup({ maturity: "INTERMEDIATE", configType: "pump", dose: 0.8 })
      const res = await adjustmentService.createProposal(
        { patientId: 1, parameterType: "basalRate", proposedValue: 0.75, reason: "patientRequested", pumpBasalSlotId: "11111111-1111-1111-1111-111111111111" },
        patient,
      )
      expect(res.id).toBe("d1")
      expect(create.mock.calls[0]![0].data.sickDayAcknowledgedAt).toBeNull() // non fourni → null (non requis pompe)
    })

    it("POMPE JUNIOR → maturityTooLowForDecrease", async () => {
      setup({ maturity: "JUNIOR", configType: "pump", dose: 0.8 })
      await expect(adjustmentService.createProposal(
        { patientId: 1, parameterType: "basalRate", proposedValue: 0.75, reason: "patientRequested", pumpBasalSlotId: "11111111-1111-1111-1111-111111111111" },
        patient,
      )).rejects.toThrow("maturityTooLowForDecrease")
    })

    it("STYLO amplitude > 2 U → patientDeltaTooLarge (cap min(10 %, 2 U))", async () => {
      setup({ maturity: "CONFIRME", configType: "single_injection", dose: 22 }) // −3 U (22→19) > 2 U
      await expect(adjustmentService.createProposal(
        { patientId: 1, parameterType: "basalRate", proposedValue: 19, reason: "patientRequested", basalDoseKind: "daily", sickDayAcknowledged: true },
        patient,
      )).rejects.toThrow("patientDeltaTooLarge")
    })

    it("discriminateur STYLO sur une config POMPE → deliveryModeMismatch (anti-tamper E1)", async () => {
      setup({ maturity: "CONFIRME", configType: "pump", dose: 22 }) // config pompe, mais body basalDoseKind
      await expect(adjustmentService.createProposal(
        { patientId: 1, parameterType: "basalRate", proposedValue: 20, reason: "patientRequested", basalDoseKind: "daily", sickDayAcknowledged: true },
        patient,
      )).rejects.toThrow("deliveryModeMismatch")
    })

    it("STYLO baisse infra-incrément (−0,5 U < 1 U) → noChangeProposed", async () => {
      setup({ maturity: "CONFIRME", configType: "single_injection", dose: 22 })
      await expect(adjustmentService.createProposal(
        { patientId: 1, parameterType: "basalRate", proposedValue: 21.5, reason: "patientRequested", basalDoseKind: "daily", sickDayAcknowledged: true },
        patient,
      )).rejects.toThrow("noChangeProposed")
    })
  })

})
