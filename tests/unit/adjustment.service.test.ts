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

import { adjustmentService } from "@/lib/services/adjustment.service"

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

    // US-2664 — le compteur d'un PATIENT ne doit inclure QUE ses propres demandes (pas d'algo/soignant).
    it("sources=['patient'] → chaque count filtre par where.source IN (métadonnée non divulguée)", async () => {
      prismaMock.adjustmentProposal.count.mockResolvedValue(0 as never)
      await adjustmentService.summary(1, ["patient"])
      for (const call of prismaMock.adjustmentProposal.count.mock.calls) {
        expect((call[0] as { where?: Record<string, unknown> })?.where).toMatchObject({ source: { in: ["patient"] } })
      }
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p1", 2, true)
      expect(result.applied).toBe(true)
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ moment: "morning", patientInsulin: expect.objectContaining({ patientId: 1, isActive: true }) }),
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, true)).rejects.toThrow("baselineMoved")
      expect(updateMany).not.toHaveBeenCalled() // rollback → dose jamais écrite sur une base déplacée
    })

    // US-2663 (S3d) — durcissement fail-closed du bug pré-existant : le modèle par-valeur est usage-blind
    // (`moment` seul). Si deux `PatientInsulin` (bolus + basal) partagent le moment ET la valeur, `updateMany`
    // toucherait PLUSIEURS lignes (count > 1) → écriture multiple silencieuse sur la mauvaise insuline.
    // Désormais REFUSÉ (`fixedDoseSlotAmbiguous`), avant : seul count 0 était gardé.
    it("US-2663 S3d : fixedDose apply matchant PLUSIEURS lignes (usage ambigu) → fixedDoseSlotAmbiguous", async () => {
      prismaMock.fixedDoseSlot.findFirst.mockResolvedValue({ valueU: 10 } as never)
      const updateMany = vi.fn().mockResolvedValue({ count: 2 }) // 2 insulines, même moment + valeur
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "fixedDose", proposedValue: 12, currentValue: 10, moment: "morning",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        fixedDoseSlot: { updateMany },
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, true)).rejects.toThrow("fixedDoseSlotAmbiguous")
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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

    // US-2664 (sûreté MDR, verrou anti-drift) — le filtre `sources` DOIT se traduire en `where.source IN`
    // en base. Sans ce test, retirer la clause (adjustment.service.ts) passerait inaperçu (le test de la
    // route mocke `list`) → un patient verrait TOUTES les provenances. Garde-fou anti-auto-injection (ADR #13).
    it("sources=['patient'] → filtre RÉELLEMENT en base (where.source IN)", async () => {
      prismaMock.adjustmentProposal.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      await adjustmentService.list(1, { status: "pending", sources: ["patient"] }, 1)
      expect(prismaMock.adjustmentProposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ patientId: 1, source: { in: ["patient"] } }) }),
      )
    })

    it("sans sources → aucune restriction de provenance (where.source absent)", async () => {
      prismaMock.adjustmentProposal.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      await adjustmentService.list(1, { status: "pending" }, 1)
      const where = (prismaMock.adjustmentProposal.findMany.mock.calls.at(-1)?.[0] as { where?: Record<string, unknown> })?.where
      expect(where).not.toHaveProperty("source")
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
      // Assertion robuste sur la FORME (pas une sous-chaîne) : metadata = uniquement le pivot
      // { applyImmediately, patientId } ; la dose (proposedValue/currentValue) n'entre nulle part.
      expect(auditCreate).toHaveBeenCalledTimes(1)
      const auditData = auditCreate.mock.calls[0]?.[0]?.data
      expect(auditData.action).toBe("PROPOSAL_ACCEPTED")
      expect(auditData.metadata).toEqual({ applyImmediately: true, patientId: 1 })
      // Aucune valeur de dose dans oldValue/newValue (createAuditData → Prisma.JsonNull par défaut).
      expect(auditData.oldValue).not.toBe(20)
      expect(auditData.newValue).not.toBe(20)
    })

    it("STYLO 'morning' / 'evening' → cible la colonne correspondante (morningDose / eveningDose)", async () => {
      const run = async (kind: "morning" | "evening", column: string, live: Record<string, unknown>) => {
        prismaMock.basalConfiguration.findFirst.mockResolvedValue(live as never)
        const updateMany = vi.fn().mockResolvedValue({ count: 1 })
        const mockTx = {
          adjustmentProposal: { findUnique: vi.fn().mockResolvedValue(styloProposal("p", { basalDoseKind: kind })), update: vi.fn().mockResolvedValue({}) },
          basalConfiguration: { updateMany },
          slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(adjustmentService.accept("p8", 2, true)).rejects.toThrow("baselineMoved")
      expect(updateMany).not.toHaveBeenCalled()
    })

    it("accept SANS apply d'une proposition STYLO → accepté (statut), non appliqué (aucune écriture)", async () => {
      const mockTx = {
        adjustmentProposal: { findUnique: vi.fn().mockResolvedValue(styloProposal("p6")), update: vi.fn().mockResolvedValue({}) },
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(adjustmentService.accept("p12", 2, true)).rejects.toThrow("basalTargetAmbiguous")
    })
  })

  // US-2660 (code-review MED #A) — le CAS ATOMIQUE (valeur attendue verrouillée dans le WHERE) est
  // aussi porté sur les 4 leviers EXISTANTS (ISF/ICR/pompe/dose fixe). Sans ces assertions, une
  // régression retirant `casValue` de leur WHERE passerait au vert. On verrouille : (1) le WHERE
  // contient bien `<colonne>: currentValue` ; (2) la fenêtre TOCTOU (updateMany count 0 alors que
  // le check explicite baselineMoved a réussi) → …SlotNotFound (rollback).
  describe("accept — CAS atomique sur les 4 leviers existants (US-2660)", () => {
    it("ISF : WHERE verrouille sensitivityFactorGl = currentValue (CAS atomique)", async () => {
      prismaMock.insulinSensitivityFactor.findFirst.mockResolvedValue({ sensitivityFactorGl: 0.5 } as never)
      const updateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "i1", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor", proposedValue: 0.55, currentValue: 0.5, timeSlotStartHour: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany },
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await adjustmentService.accept("i1", 2, true)
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ settings: { patientId: 1 }, startHour: 8, sensitivityFactorGl: 0.5 }),
        }),
      )
    })

    it("ICR : WHERE verrouille gramsPerUnit = currentValue (CAS atomique)", async () => {
      prismaMock.carbRatio.findFirst.mockResolvedValue({ gramsPerUnit: 10 } as never)
      const updateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "c1", patientId: 1, status: "pending",
            parameterType: "insulinToCarbRatio", proposedValue: 11, currentValue: 10, carbRatioSlotStart: 12,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        carbRatio: { updateMany },
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await adjustmentService.accept("c1", 2, true)
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ settings: { patientId: 1 }, startHour: 12, gramsPerUnit: 10 }),
        }),
      )
    })

    it("pompe : WHERE verrouille rate = currentValue (CAS atomique, scopé patient)", async () => {
      prismaMock.pumpBasalSlot.findFirst.mockResolvedValue({ rate: 0.8 } as never)
      const updateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "b1", patientId: 1, status: "pending",
            parameterType: "basalRate", proposedValue: 0.85, currentValue: 0.8, pumpBasalSlotId: "slot-1",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        pumpBasalSlot: { updateMany },
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await adjustmentService.accept("b1", 2, true)
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "slot-1",
            basalConfig: { settings: { patientId: 1 } },
            rate: 0.8,
          }),
        }),
      )
    })

    it("dose fixe : WHERE verrouille valueU = currentValue (CAS atomique)", async () => {
      prismaMock.fixedDoseSlot.findFirst.mockResolvedValue({ valueU: 10 } as never)
      const updateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "f1", patientId: 1, status: "pending",
            parameterType: "fixedDose", proposedValue: 12, currentValue: 10, moment: "morning",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        fixedDoseSlot: { updateMany },
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await adjustmentService.accept("f1", 2, true)
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ patientInsulin: expect.objectContaining({ patientId: 1, isActive: true }), moment: "morning", valueU: 10 }),
        }),
      )
    })

    it("TOCTOU : baselineMoved OK mais updateMany count 0 (écriture concurrente) → isfSlotNotFound, rollback", async () => {
      // liveCurrentValue = snapshot (0.5) → le check explicite baselineMoved PASSE. Mais une écriture
      // concurrente glissée avant l'updateMany fait matcher 0 ligne (CAS dans le WHERE) → fail-closed.
      prismaMock.insulinSensitivityFactor.findFirst.mockResolvedValue({ sensitivityFactorGl: 0.5 } as never)
      const updateMany = vi.fn().mockResolvedValue({ count: 0 })
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "i2", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor", proposedValue: 0.55, currentValue: 0.5, timeSlotStartHour: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany },
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(adjustmentService.accept("i2", 2, true)).rejects.toThrow("isfSlotNotFound")
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
        slotSetProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, // US-2663 S2b
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p4", 2, false)
      expect(result.accepted).toBe(true)
      expect(result.applied).toBe(false)
    })
  })

})
