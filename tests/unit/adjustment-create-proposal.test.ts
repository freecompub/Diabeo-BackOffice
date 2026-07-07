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
    fixedDoseFindFirst: vi.fn(),
    create: vi.fn((args: { data: Record<string, unknown> }) => ({ id: "p1", ...args.data })),
    logWithTx: vi.fn(),
    auditLog: vi.fn(),
    referentFindFirst: vi.fn(),
    sendToUser: vi.fn(),
    resolveTreatmentMode: vi.fn(),
    raiseFlag: vi.fn(),
  }
  return {
    mocks: m,
    prismaMock: {
      adjustmentProposal: { findFirst: m.adjFindFirst },
      insulinSensitivityFactor: { findFirst: m.isfFindFirst },
      carbRatio: { findFirst: m.icrFindFirst },
      pumpBasalSlot: { findFirst: m.basalFindFirst },
      fixedDoseSlot: { findFirst: m.fixedDoseFindFirst },
      patientReferent: { findFirst: m.referentFindFirst },
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ adjustmentProposal: { create: m.create } }),
    },
  }
})
vi.mock("@/lib/db/client", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { logWithTx: mocks.logWithTx, log: mocks.auditLog },
}))
vi.mock("@/lib/services/fcm.service", () => ({ fcmService: { sendToUser: mocks.sendToUser } }))
vi.mock("@/lib/services/treatment-mode.service", () => ({
  treatmentModeService: { resolveTreatmentMode: mocks.resolveTreatmentMode },
}))
vi.mock("@/lib/services/clinical-review-flag.service", () => ({
  clinicalReviewFlagService: { raise: mocks.raiseFlag },
}))
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
  mocks.referentFindFirst.mockResolvedValue({ pro: { userId: 99 } }) // médecin référent
  mocks.sendToUser.mockResolvedValue({ sent: 1 })
  mocks.resolveTreatmentMode.mockResolvedValue({ mode: "basalBolus", coherent: true }) // patient insuliné par défaut
  mocks.raiseFlag.mockResolvedValue({ flagId: "f1", created: true })
  mocks.auditLog.mockResolvedValue(undefined)
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

  it("mode nonInsulin → nonInsulinNoDose, aucune écriture (frontière MDR, US-2651)", async () => {
    mocks.resolveTreatmentMode.mockResolvedValue({ mode: "nonInsulin", coherent: true })
    await expect(adjustmentService.createProposal(isf(0.52), nurse)).rejects.toThrow("nonInsulinNoDose")
    expect(mocks.create).not.toHaveBeenCalled()
    // Un clinicien (nurse) agit directement → aucun flag d'orientation levé.
    expect(mocks.raiseFlag).not.toHaveBeenCalled()
    // Mais la tentative refusée EST tracée (observabilité), sans dose.
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PROPOSAL_REFUSED",
        metadata: expect.objectContaining({ reason: "nonInsulinNoDose", proposedByRole: "nurse" }),
      }),
    )
  })

  it("PATIENT nonInsulin → tentative tracée + flag d'orientation levé, puis refus", async () => {
    mocks.resolveTreatmentMode.mockResolvedValue({ mode: "nonInsulin", coherent: true })
    await expect(adjustmentService.createProposal(isf(0.52), patient)).rejects.toThrow("nonInsulinNoDose")
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PROPOSAL_REFUSED", metadata: expect.objectContaining({ proposedByRole: "patient" }) }),
    )
    expect(mocks.raiseFlag).toHaveBeenCalledWith(5, "reviewInConsultation", patient.userId, undefined)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("PATIENT nonInsulin : un échec du flag ne masque pas le refus (best-effort)", async () => {
    mocks.resolveTreatmentMode.mockResolvedValue({ mode: "nonInsulin", coherent: true })
    mocks.raiseFlag.mockRejectedValue(new Error("db down"))
    await expect(adjustmentService.createProposal(isf(0.52), patient)).rejects.toThrow("nonInsulinNoDose")
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
  it("basal hors incrément pompe (0,37 U/h) → valueOutOfBounds (non délivrable)", async () => {
    await expect(
      adjustmentService.createProposal(
        { patientId: 5, parameterType: "basalRate", proposedValue: 0.37, reason: "manualAdjustment", pumpBasalSlotId: "slot1" },
        nurse,
      ),
    ).rejects.toThrow("valueOutOfBounds")
    expect(mocks.create).not.toHaveBeenCalled()
  })

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

  // US-2650 — cooldown anti-churn (24 h, PATIENT uniquement).
  it("PATIENT : re-proposition du même créneau < 24 h après résolution → patientProposalCooldown", async () => {
    // 1er findFirst = requête cooldown → dernière proposition résolue à l'instant.
    mocks.adjFindFirst.mockResolvedValue({ reviewedAt: new Date(), createdAt: new Date() })
    await expect(adjustmentService.createProposal(isf(0.52), patient)).rejects.toThrow("patientProposalCooldown")
  })

  it("PATIENT : dernière proposition résolue > 24 h → autorisée", async () => {
    const old = new Date(Date.now() - 25 * 3_600_000)
    mocks.adjFindFirst
      .mockResolvedValueOnce({ reviewedAt: old, createdAt: old }) // cooldown : expiré
      .mockResolvedValueOnce(null) // anti-spam : pas de pending
    await expect(adjustmentService.createProposal(isf(0.52), patient)).resolves.toMatchObject({ id: "p1" })
  })

  it("NURSE : jamais gaté par le cooldown (aucune requête cooldown émise)", async () => {
    mocks.adjFindFirst.mockResolvedValue(null)
    await expect(adjustmentService.createProposal(isf(0.52), nurse)).resolves.toMatchObject({ id: "p1" })
    // Preuve du gate de rôle : la requête cooldown (`status != pending`) n'est JAMAIS émise
    // pour un nurse (seule l'anti-spam `status: "pending"` l'est).
    const cooldownQueries = mocks.adjFindFirst.mock.calls.filter(
      (call) => JSON.stringify(call[0]?.where?.status) === JSON.stringify({ not: "pending" }),
    )
    expect(cooldownQueries).toHaveLength(0)
  })

  it("PATIENT : la requête cooldown (status != pending) EST émise", async () => {
    mocks.adjFindFirst.mockResolvedValue(null) // ni cooldown ni pending → passe
    await adjustmentService.createProposal(isf(0.52), patient)
    const cooldownQueries = mocks.adjFindFirst.mock.calls.filter(
      (call) => JSON.stringify(call[0]?.where?.status) === JSON.stringify({ not: "pending" }),
    )
    expect(cooldownQueries).toHaveLength(1)
  })
})

describe("createProposal — fixedDose (câblé US-2652) & anti-spam", () => {
  it("fixedDose SANS moment → slotRequired (discriminateur obligatoire)", async () => {
    await expect(
      adjustmentService.createProposal(
        { patientId: 5, parameterType: "fixedDose", proposedValue: 12, reason: "manualAdjustment" },
        nurse,
      ),
    ).rejects.toThrow("slotRequired")
  })

  it("fixedDose avec moment mais slot inexistant → currentValueNotFound (anti-IDOR)", async () => {
    mocks.fixedDoseFindFirst.mockResolvedValue(null)
    await expect(
      adjustmentService.createProposal(
        { patientId: 5, parameterType: "fixedDose", proposedValue: 12, reason: "manualAdjustment", moment: "morning" },
        nurse,
      ),
    ).rejects.toThrow("currentValueNotFound")
  })

  it("fixedDose avec moment + slot existant → proposition créée (moment persisté)", async () => {
    mocks.fixedDoseFindFirst.mockResolvedValue({ valueU: 10 }) // dose courante 10 U
    await adjustmentService.createProposal(
      { patientId: 5, parameterType: "fixedDose", proposedValue: 12, reason: "manualAdjustment", moment: "morning" },
      nurse,
    )
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const data = mocks.create.mock.calls[0]![0].data as Record<string, unknown>
    expect(data).toMatchObject({ parameterType: "fixedDose", moment: "morning" })
    expect(data.timeSlotStartHour).toBeNull() // discriminateurs parasites zéroés
  })

  it("pending existant (pré-check) → duplicatePendingProposal", async () => {
    mocks.adjFindFirst.mockResolvedValue({ id: "existing" })
    await expect(adjustmentService.createProposal(isf(0.52), nurse)).rejects.toThrow("duplicatePendingProposal")
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("course TOCTOU : violation de l'index anti-spam (P2002) → duplicatePendingProposal", async () => {
    mocks.create.mockImplementation(() => {
      throw Object.assign(new Error("unique"), {
        code: "P2002",
        meta: { target: ["adjustment_proposals_one_pending_per_slot"] },
      })
    })
    await expect(adjustmentService.createProposal(isf(0.52), nurse)).rejects.toThrow("duplicatePendingProposal")
  })

  it("P2002 d'une AUTRE contrainte n'est PAS masqué en duplicate", async () => {
    mocks.create.mockImplementation(() => {
      throw Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["some_other_unique"] } })
    })
    await expect(adjustmentService.createProposal(isf(0.52), nurse)).rejects.not.toThrow("duplicatePendingProposal")
  })
})

describe("createProposal — dérivation ICR/basal & normalisation créneau", () => {
  it("ICR : currentValue dérivé de carbRatio", async () => {
    mocks.icrFindFirst.mockResolvedValue({ gramsPerUnit: 10 })
    await adjustmentService.createProposal(
      { patientId: 5, parameterType: "insulinToCarbRatio", proposedValue: 11, reason: "manualAdjustment", carbRatioSlotStart: 8, carbRatioSlotEnd: 12 },
      nurse,
    )
    expect(mocks.icrFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0]![0].data).toMatchObject({ currentValue: 10, parameterType: "insulinToCarbRatio" })
  })

  it("basal : créneau introuvable → currentValueNotFound", async () => {
    mocks.basalFindFirst.mockResolvedValue(null)
    await expect(
      adjustmentService.createProposal(
        { patientId: 5, parameterType: "basalRate", proposedValue: 1.1, reason: "manualAdjustment", pumpBasalSlotId: "slotX" },
        nurse,
      ),
    ).rejects.toThrow("currentValueNotFound")
  })

  it("créneau manquant → slotRequired (avant tout accès DB d'anti-spam)", async () => {
    await expect(
      adjustmentService.createProposal(
        { patientId: 5, parameterType: "insulinSensitivityFactor", proposedValue: 0.52, reason: "manualAdjustment" },
        nurse,
      ),
    ).rejects.toThrow("slotRequired")
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("A — discriminateur parasite (pumpBasalSlotId sur une proposition ISF) forcé à null", async () => {
    await adjustmentService.createProposal({ ...isf(0.52), pumpBasalSlotId: "parasite" }, nurse)
    const data = mocks.create.mock.calls[0]![0].data
    expect(data.pumpBasalSlotId).toBeNull()
    expect(data.timeSlotStartHour).toBe(8)
  })
})

describe("createProposal — notification du médecin référent (US-2649b)", () => {
  // Notif en fire-and-forget → assertion après drain des microtasks.
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it("NURSE : push au référent, type proposal_review, AUCUNE dose dans tout le payload", async () => {
    await adjustmentService.createProposal(isf(0.52), nurse)
    await vi.waitFor(() => expect(mocks.sendToUser).toHaveBeenCalledTimes(1))
    const arg = mocks.sendToUser.mock.calls[0]![0]
    expect(arg).toMatchObject({ userId: 99, data: { type: "proposal_review", proposalId: "p1" } })
    // Payload COMPLET (title/body/data) sans valeur de dose (0.52) ni currentValue (0.5).
    expect(JSON.stringify(arg)).not.toContain("0.52")
    expect(JSON.stringify(arg.data)).not.toContain("0.5")
  })

  it("ne se notifie pas soi-même (proposeur = référent)", async () => {
    await adjustmentService.createProposal(isf(0.52), { userId: 99, role: "doctor" })
    await tick()
    expect(mocks.sendToUser).not.toHaveBeenCalled()
  })

  it("pas de référent → pas de push, création OK", async () => {
    mocks.referentFindFirst.mockResolvedValue(null)
    await expect(adjustmentService.createProposal(isf(0.52), nurse)).resolves.toMatchObject({ id: "p1" })
    await tick()
    expect(mocks.sendToUser).not.toHaveBeenCalled()
  })

  it("best-effort : un échec push ne casse pas la création", async () => {
    mocks.sendToUser.mockRejectedValue(new Error("fcm down"))
    await expect(adjustmentService.createProposal(isf(0.52), nurse)).resolves.toMatchObject({ id: "p1" })
    await tick()
  })
})
