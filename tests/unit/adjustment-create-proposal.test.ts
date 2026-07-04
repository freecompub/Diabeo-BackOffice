/**
 * US-2649a — Primitive de création d'une proposition d'ajustement HUMAINE.
 *
 * Garde-fous de sécurité patient testés (imposés SERVEUR) :
 *  - bornes cliniques rejetées à la création ;
 *  - patient : sens interdit (pas de baisse basale/dose) + cap de variation resserré ;
 *  - anti-spam (1 pending par créneau) ;
 *  - provenance dérivée du proposer (jamais du body), métriques moteur nulles,
 *    commentaire chiffré, jamais auto-appliqué, audit sans PHI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { prismaMock, createMock, findFirstMock, logWithTxMock } = vi.hoisted(() => {
  const create = vi.fn((args: { data: Record<string, unknown> }) => ({ id: "p1", ...args.data }))
  const findFirst = vi.fn()
  return {
    createMock: create,
    findFirstMock: findFirst,
    logWithTxMock: vi.fn(),
    prismaMock: {
      adjustmentProposal: { findFirst },
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ adjustmentProposal: { create } }),
    },
  }
})
vi.mock("@/lib/db/client", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit.service", () => ({ auditService: { logWithTx: logWithTxMock } }))
vi.mock("@/lib/services/fcm.service", () => ({ fcmService: {} }))
vi.mock("@/lib/crypto/fields", () => ({
  encryptField: (s: string) => `enc(${s})`,
  safeDecryptField: (s: string) => s,
}))
vi.mock("@/lib/services/insulin-therapy.service", async () => {
  const { CLINICAL_BOUNDS } = await import("@/lib/clinical-bounds")
  return { INSULIN_BOUNDS: CLINICAL_BOUNDS }
})

import { adjustmentService, type CreateProposalInput } from "@/lib/services/adjustment.service"

const nurse = { userId: 20, role: "nurse" as const }
const patient = { userId: 42, role: "patient" as const }

const isfInput: CreateProposalInput = {
  patientId: 5,
  parameterType: "insulinSensitivityFactor",
  currentValue: 0.5,
  proposedValue: 0.52, // +4 %
  reason: "manualAdjustment",
  timeSlotStartHour: 8,
  timeSlotEndHour: 12,
}

beforeEach(() => {
  createMock.mockClear()
  findFirstMock.mockReset()
  logWithTxMock.mockClear()
  findFirstMock.mockResolvedValue(null) // pas de doublon par défaut
})

describe("createProposal — création & provenance", () => {
  it("NURSE : crée une proposition pending, provenance serveur, métriques nulles, jamais appliquée", async () => {
    const p = await adjustmentService.createProposal(isfInput, nurse)
    expect(createMock).toHaveBeenCalledTimes(1)
    const data = createMock.mock.calls[0]![0].data
    expect(data).toMatchObject({
      source: "nurse",
      proposedByUserId: 20,
      confidence: null,
      supportingEvents: null,
      status: "pending",
      patientId: 5,
    })
    expect(p.id).toBe("p1")
  })

  it("audit SANS PHI : provenance + patient, jamais la valeur de dose", async () => {
    await adjustmentService.createProposal(isfInput, nurse)
    const audit = logWithTxMock.mock.calls[0]![1]
    expect(audit).toMatchObject({
      action: "CREATE",
      resource: "ADJUSTMENT_PROPOSAL",
      metadata: { patientId: 5, proposedByRole: "nurse" },
    })
    expect(JSON.stringify(audit.metadata)).not.toContain("0.52")
  })

  it("proposerComment chiffré au stockage", async () => {
    await adjustmentService.createProposal({ ...isfInput, proposerComment: "hypos le matin" }, patient)
    expect(createMock.mock.calls[0]![0].data.proposerComment).toBe("enc(hypos le matin)")
  })
})

describe("createProposal — bornes & garde-fous patient", () => {
  it("hors bornes cliniques → valueOutOfBounds, aucune création", async () => {
    await expect(
      adjustmentService.createProposal({ ...isfInput, proposedValue: 0.05 }, nurse),
    ).rejects.toThrow("valueOutOfBounds")
    expect(createMock).not.toHaveBeenCalled()
  })

  it("PATIENT : baisse de basale interdite", async () => {
    await expect(
      adjustmentService.createProposal(
        { ...isfInput, parameterType: "basalRate", currentValue: 1.0, proposedValue: 0.8 },
        patient,
      ),
    ).rejects.toThrow("patientDecreaseForbidden")
  })

  it("PATIENT : dose fixe au-delà du cap patient (±1 U) rejetée", async () => {
    await expect(
      adjustmentService.createProposal(
        { ...isfInput, parameterType: "fixedDose", currentValue: 10, proposedValue: 12 },
        patient,
      ),
    ).rejects.toThrow("patientDeltaTooLarge")
  })

  it("PATIENT : variation de ratio > 10 % rejetée", async () => {
    await expect(
      adjustmentService.createProposal({ ...isfInput, proposedValue: 0.6 }, patient), // +20 %
    ).rejects.toThrow("patientDeltaTooLarge")
  })

  it("NURSE : variation > 10 % autorisée (cap patient non applicable)", async () => {
    await expect(
      adjustmentService.createProposal({ ...isfInput, proposedValue: 0.6 }, nurse),
    ).resolves.toMatchObject({ id: "p1" })
  })
})

describe("createProposal — anti-spam", () => {
  it("proposition pending existante sur le même créneau → duplicatePendingProposal", async () => {
    findFirstMock.mockResolvedValue({ id: "existing" })
    await expect(adjustmentService.createProposal(isfInput, nurse)).rejects.toThrow(
      "duplicatePendingProposal",
    )
    expect(createMock).not.toHaveBeenCalled()
  })
})
