/**
 * US-2649a — Primitive de création d'une proposition d'ajustement HUMAINE.
 *
 * Garde-fous de sécurité patient testés (imposés SERVEUR) :
 *  - `currentValue` dérivé serveur (jamais du body) → garde-fous ininviolables ;
 *  - bornes cliniques rejetées à la création ; `changePercent` clampé (anti-overflow) ;
 *  - patient : sens interdit (pas de baisse basale) + cap de variation ;
 *  - anti-spam (pré-check + P2002 de l'index partiel) ;
 *  - fixedDose rejeté (non câblé) ; provenance dérivée, métriques nulles, comment chiffré,
 *    jamais auto-appliqué, audit sans PHI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { prismaMock, mocks } = vi.hoisted(() => {
  const m = {
    adjFindFirst: vi.fn(),
    isfFindFirst: vi.fn(),
    icrFindFirst: vi.fn(),
    basalFindFirst: vi.fn(),
    create: vi.fn((args: { data: Record<string, unknown> }) => ({ id: "p1", ...args.data })),
    logWithTx: vi.fn(),
  }
  return {
    mocks: m,
    prismaMock: {
      adjustmentProposal: { findFirst: m.adjFindFirst },
      insulinSensitivityFactor: { findFirst: m.isfFindFirst },
      carbRatio: { findFirst: m.icrFindFirst },
      pumpBasalSlot: { findFirst: m.basalFindFirst },
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ adjustmentProposal: { create: m.create } }),
    },
  }
})
vi.mock("@/lib/db/client", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit.service", () => ({ auditService: { logWithTx: mocks.logWithTx } }))
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

/** Proposition ISF (créneau 8-12 h). currentValue dérivé serveur (mock à 0.5). */
const isf = (proposedValue: number): CreateProposalInput => ({
  patientId: 5,
  parameterType: "insulinSensitivityFactor",
  proposedValue,
  reason: "manualAdjustment",
  timeSlotStartHour: 8,
  timeSlotEndHour: 12,
})

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.create.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: "p1", ...args.data }))
  mocks.adjFindFirst.mockResolvedValue(null) // pas de doublon
  mocks.isfFindFirst.mockResolvedValue({ sensitivityFactorGl: 0.5 }) // valeur courante de confiance
  mocks.basalFindFirst.mockResolvedValue({ rate: 1.0 })
})

describe("createProposal — provenance & currentValue serveur", () => {
  it("NURSE : pending, provenance serveur, currentValue dérivé, métriques nulles", async () => {
    await adjustmentService.createProposal(isf(0.52), nurse)
    const data = mocks.create.mock.calls[0]![0].data
    expect(data).toMatchObject({
      source: "nurse",
      proposedByUserId: 20,
      currentValue: 0.5, // dérivé serveur, PAS du body
      proposedValue: 0.52,
      confidence: null,
      supportingEvents: null,
      status: "pending",
    })
    expect(data.changePercent).toBeCloseTo(4, 1)
  })

  it("audit SANS PHI (provenance + patient, jamais la dose)", async () => {
    await adjustmentService.createProposal(isf(0.52), nurse)
    const audit = mocks.logWithTx.mock.calls[0]![1]
    expect(audit).toMatchObject({ action: "CREATE", metadata: { patientId: 5, proposedByRole: "nurse" } })
    expect(Object.keys(audit.metadata)).toEqual(["patientId", "proposedByRole"])
  })

  it("proposerComment chiffré au stockage", async () => {
    await adjustmentService.createProposal({ ...isf(0.52), proposerComment: "hypos matin" }, patient)
    expect(mocks.create.mock.calls[0]![0].data.proposerComment).toBe("enc(hypos matin)")
  })

  it("créneau introuvable (autre patient / absent) → currentValueNotFound", async () => {
    mocks.isfFindFirst.mockResolvedValue(null)
    await expect(adjustmentService.createProposal(isf(0.52), nurse)).rejects.toThrow("currentValueNotFound")
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe("createProposal — bornes, overflow, garde-fous patient", () => {
  it("hors bornes → valueOutOfBounds, aucune création", async () => {
    await expect(adjustmentService.createProposal(isf(0.05), nurse)).rejects.toThrow("valueOutOfBounds")
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("changePercent clampé à 999.99 (anti-overflow Decimal(5,2))", async () => {
    // basale 0.05 → 5.0 = 9900 % → clampé.
    mocks.basalFindFirst.mockResolvedValue({ rate: 0.05 })
    await adjustmentService.createProposal(
      { patientId: 5, parameterType: "basalRate", proposedValue: 5.0, reason: "manualAdjustment", pumpBasalSlotId: "slot1" },
      nurse,
    )
    expect(mocks.create.mock.calls[0]![0].data.changePercent).toBe(999.99)
  })

  it("PATIENT : baisse de basale interdite", async () => {
    await expect(
      adjustmentService.createProposal(
        { patientId: 5, parameterType: "basalRate", proposedValue: 0.8, reason: "patientRequested", pumpBasalSlotId: "slot1" },
        patient, // current 1.0 → delta -0.2
      ),
    ).rejects.toThrow("patientDecreaseForbidden")
  })

  it("PATIENT : variation de ratio > 10 % rejetée", async () => {
    await expect(adjustmentService.createProposal(isf(0.6), patient)).rejects.toThrow("patientDeltaTooLarge")
  })

  it("NURSE : variation > 10 % autorisée (cap patient non applicable)", async () => {
    await expect(adjustmentService.createProposal(isf(0.6), nurse)).resolves.toMatchObject({ id: "p1" })
  })
})

describe("createProposal — fixedDose non câblé & anti-spam", () => {
  it("fixedDose → fixedDoseNotWired (fail-closed)", async () => {
    await expect(
      adjustmentService.createProposal(
        { patientId: 5, parameterType: "fixedDose", proposedValue: 12, reason: "manualAdjustment" },
        nurse,
      ),
    ).rejects.toThrow("fixedDoseNotWired")
  })

  it("pending existant (pré-check) → duplicatePendingProposal", async () => {
    mocks.adjFindFirst.mockResolvedValue({ id: "existing" })
    await expect(adjustmentService.createProposal(isf(0.52), nurse)).rejects.toThrow("duplicatePendingProposal")
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("course TOCTOU : violation d'index (P2002) → duplicatePendingProposal", async () => {
    mocks.create.mockImplementation(() => {
      throw Object.assign(new Error("unique"), { code: "P2002" })
    })
    await expect(adjustmentService.createProposal(isf(0.52), nurse)).rejects.toThrow("duplicatePendingProposal")
  })
})
