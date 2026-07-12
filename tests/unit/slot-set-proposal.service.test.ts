/**
 * US-2657 (slice C3a) — Service des propositions d'ensemble de créneaux.
 * Comportement testé :
 *  - create : validation forme + bornes cliniques À LA CRÉATION, garde patient soft-deleted, frontière MDR
 *    nonInsulin, supersede des pending (ensemble + par-valeur), audit, P2002 (forme Prisma 7 + adapter-pg)
 *    → duplicatePendingProposal ;
 *  - accept : ATOMIQUE (flip gardé compare-and-swap → apply `replaceSlotSet(tx)` → audit dans une seule
 *    transaction), fail-closed si apply throw, pas d'apply si flip perdu (course) ou introuvable ;
 *  - reject : flip + audit ; scoping patient (anti-IDOR → notFound) ;
 *  - list : audit READ.
 *
 * `assertValidSlotSet` est la VRAIE implémentation (importActual) — la validation à la création est donc
 * réellement exercée ; seul `insulinTherapyService.replaceSlotSet` est mocké.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/insulin-therapy.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/insulin-therapy.service")>()
  return {
    ...actual, // garde le vrai `assertValidSlotSet`
    insulinTherapyService: {
      replaceSlotSet: vi.fn().mockResolvedValue({
        applied: true,
        count: 3,
        coverage: { hasGap: false, hasOverlap: false },
        supersededProposalIds: [],
        supersededSetProposalIds: [],
      }),
    },
  }
})
vi.mock("@/lib/services/treatment-mode.service", () => ({
  treatmentModeService: { resolveTreatmentMode: vi.fn().mockResolvedValue({ mode: "basalBolus" }) },
}))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: vi.fn(), logWithTx: vi.fn() },
}))

const { slotSetProposalService } = await import("@/lib/services/slot-set-proposal.service")
const { insulinTherapyService } = await import("@/lib/services/insulin-therapy.service")
const { treatmentModeService } = await import("@/lib/services/treatment-mode.service")
const { auditService } = await import("@/lib/services/audit.service")

// Jeu ISF VALIDE : couverture 24 h sans trou ni chevauchement (0-8, 8-22, 22-24), valeurs ∈ [0.10, 1.00] g/L.
const SLOTS = [
  { startHour: 0, endHour: 8, value: 0.5 },
  { startHour: 8, endHour: 22, value: 0.45 },
  { startHour: 22, endHour: 0, value: 0.4 },
]
// Jeu ICR VALIDE : couverture 24 h (0-12, 12-24), valeurs ∈ [3.0, 30.0] g/U.
const ICR_SLOTS = [
  { startHour: 0, endHour: 12, value: 10 },
  { startHour: 12, endHour: 0, value: 12 },
]
// Snapshot de base (US-2663 S1) — forme valide, passé tel quel à `replaceSlotSet` comme `expectedBaseline`.
const BASE = [
  { startHour: 0, endHour: 12, value: 0.5 },
  { startHour: 12, endHour: 0, value: 0.45 },
]

/** Fabrique un `tx` factice dont `$transaction` exécute le callback. */
function mockTx() {
  const tx = {
    slotSetProposal: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    adjustmentProposal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  }
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
  return tx
}

describe("slotSetProposalService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // US-2663 (S0) — `captureBaselineSlots` lit la config ISF/ICR ACTIVE ; défaut = aucune config (base vide).
    prismaMock.insulinSensitivityFactor.findMany.mockResolvedValue([] as never)
    prismaMock.carbRatio.findMany.mockResolvedValue([] as never)
  })

  // ── create ──────────────────────────────────────────────────────────────
  it("createSetProposal : supersède les pending (ensemble + par-valeur) + crée + audit READ SLOT_SET_PROPOSAL", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })
    tx.slotSetProposal.create.mockResolvedValue({ id: "set-1" })

    const res = await slotSetProposalService.createSetProposal(7, "insulinSensitivityFactor", SLOTS, { userId: 7, source: "patient" })
    expect(res).toEqual({ id: "set-1" })
    expect(tx.slotSetProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientId: 7, parameterType: "insulinSensitivityFactor", status: "pending" }, data: { status: "superseded" } }),
    )
    // « Plus de par-valeur » : supersede aussi les AdjustmentProposal pending du même paramètre.
    expect(tx.adjustmentProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientId: 7, parameterType: "insulinSensitivityFactor", status: "pending" } }),
    )
    expect(auditService.logWithTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "CREATE", resource: "SLOT_SET_PROPOSAL", resourceId: "set-1" }),
    )
  })

  it("createSetProposal (US-2663 S0) : snapshot baseline ISF ACTIF + source=patient persistés", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    // Config ISF active du patient (g/L·U = sensitivityFactorGl) → baseline attendu, même encodage que proposedSlots.
    prismaMock.insulinSensitivityFactor.findMany.mockResolvedValue([
      { startHour: 0, endHour: 8, sensitivityFactorGl: 0.55 },
      { startHour: 8, endHour: 0, sensitivityFactorGl: 0.48 },
    ] as never)
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 0 })
    tx.slotSetProposal.create.mockResolvedValue({ id: "set-1" })

    await slotSetProposalService.createSetProposal(7, "insulinSensitivityFactor", SLOTS, { userId: 7, source: "patient" })

    expect(tx.slotSetProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "patient",
          proposedSlots: SLOTS,
          baselineSlots: [
            { startHour: 0, endHour: 8, value: 0.55 },
            { startHour: 8, endHour: 0, value: 0.48 },
          ],
        }),
      }),
    )
    // L'audit de création trace la provenance + les deux tailles (forensics).
    expect(auditService.logWithTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ metadata: expect.objectContaining({ source: "patient", baselineSlots: 2 }) }),
    )
  })

  it("createSetProposal (US-2663 S0) : `source` explicite (ex. algorithm) est persisté ; base vide → []", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 0 })
    tx.slotSetProposal.create.mockResolvedValue({ id: "set-2" })

    await slotSetProposalService.createSetProposal(7, "insulinSensitivityFactor", SLOTS, { userId: 7, source: "algorithm" })

    expect(tx.slotSetProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "algorithm", baselineSlots: [] }) }),
    )
  })

  it("createSetProposal (US-2663 S0) : baseline ICR capture `gramsPerUnit` + `mealLabel` conditionnel", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    // Config ICR active : une ligne avec mealLabel, une sans (null) → la clé mealLabel ne doit PAS être posée
    // pour la seconde (pas de `mealLabel: undefined` parasite dans le JSON snapshot).
    prismaMock.carbRatio.findMany.mockResolvedValue([
      { startHour: 0, endHour: 12, gramsPerUnit: 10, mealLabel: "midi" },
      { startHour: 12, endHour: 0, gramsPerUnit: 12, mealLabel: null },
    ] as never)
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 0 })
    tx.slotSetProposal.create.mockResolvedValue({ id: "set-icr" })

    await slotSetProposalService.createSetProposal(7, "insulinToCarbRatio", ICR_SLOTS, { userId: 7, source: "patient" })

    expect(tx.slotSetProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parameterType: "insulinToCarbRatio",
          baselineSlots: [
            { startHour: 0, endHour: 12, value: 10, mealLabel: "midi" },
            { startHour: 12, endHour: 0, value: 12 },
          ],
        }),
      }),
    )
    // La lecture ISF ne doit pas être déclenchée pour un paramètre ICR.
    expect(prismaMock.insulinSensitivityFactor.findMany).not.toHaveBeenCalled()
  })

  it("createSetProposal : jeu vide → emptySlotSet (avant tout accès DB)", async () => {
    await expect(slotSetProposalService.createSetProposal(7, "insulinSensitivityFactor", [], { userId: 7, source: "patient" })).rejects.toThrow("emptySlotSet")
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled()
  })

  it("createSetProposal : valeur ISF hors bornes → valueOutOfBounds DÈS la création (M6)", async () => {
    const bad = [{ startHour: 0, endHour: 12, value: 5.0 }, { startHour: 12, endHour: 0, value: 0.5 }] // 5.0 > ISF_GL_MAX
    await expect(slotSetProposalService.createSetProposal(7, "insulinSensitivityFactor", bad, { userId: 7, source: "patient" })).rejects.toThrow("valueOutOfBounds")
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled()
  })

  it("createSetProposal : patient soft-deleted / inexistant → patientNotFound", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null as never)
    await expect(slotSetProposalService.createSetProposal(7, "insulinSensitivityFactor", SLOTS, { userId: 7, source: "patient" })).rejects.toThrow("patientNotFound")
    expect(treatmentModeService.resolveTreatmentMode).not.toHaveBeenCalled()
  })

  it("createSetProposal : patient NON INSULINÉ → nonInsulinNoDose (frontière MDR, aucune écriture)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    ;(treatmentModeService.resolveTreatmentMode as any).mockResolvedValueOnce({ mode: "nonInsulin" })
    await expect(slotSetProposalService.createSetProposal(7, "insulinSensitivityFactor", SLOTS, { userId: 7, source: "patient" })).rejects.toThrow("nonInsulinNoDose")
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("createSetProposal : P2002 (forme Prisma 7 + adapter-pg) → duplicatePendingProposal", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    // Forme RÉELLE sous @prisma/adapter-pg : meta.target = undefined ; le nom de contrainte est dans
    // driverAdapterError.cause.originalMessage (cf. review prisma-specialist).
    prismaMock.$transaction.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: {
          driverAdapterError: {
            cause: {
              originalMessage: 'duplicate key value violates unique constraint "slot_set_proposals_one_pending_per_param"',
              constraint: { fields: ["patient_id", "parameter_type"] },
            },
          },
        },
      }) as never,
    )
    await expect(slotSetProposalService.createSetProposal(7, "insulinSensitivityFactor", SLOTS, { userId: 7, source: "patient" })).rejects.toThrow("duplicatePendingProposal")
  })

  // ── accept ──────────────────────────────────────────────────────────────
  it("acceptSetProposal : ATOMIQUE — flip gardé puis replaceSlotSet(tx, expectedBaseline) puis audit", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "insulinToCarbRatio", proposedSlots: SLOTS, baselineSlots: BASE })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })

    const res = await slotSetProposalService.acceptSetProposal("set-1", 7, 3)
    expect(res).toEqual({ id: "set-1", status: "accepted" })
    // Flip gardé compare-and-swap DANS la transaction, patient soft-deleted exclu à la lecture.
    expect(tx.slotSetProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "set-1", patientId: 7, status: "pending", patient: { deletedAt: null } } }),
    )
    expect(tx.slotSetProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "set-1", patientId: 7, status: "pending" }, data: expect.objectContaining({ status: "accepted", reviewedByUserId: 3 }) }),
    )
    // Apply DANS la même transaction : `tx` en 6e arg + US-2663 (S1) `expectedBaseline` (baseline parsé) en 7e.
    expect(insulinTherapyService.replaceSlotSet).toHaveBeenCalledWith("icr", 7, SLOTS, 3, undefined, tx, { baseline: BASE })
    expect(auditService.logWithTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "PROPOSAL_ACCEPTED", resource: "SLOT_SET_PROPOSAL", resourceId: "set-1" }),
    )
  })

  it("acceptSetProposal (US-2663 S1) : proposition legacy `baselineSlots=null` → `null` passé tel quel (fail-closed aval)", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, baselineSlots: null })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })

    await slotSetProposalService.acceptSetProposal("set-1", 7, 3)
    // `null` transmis → `replaceSlotSet` lèvera `baselineMissing` (CAS non certifiable). Ici replaceSlotSet est
    // mocké ; on vérifie seulement que le service ne transforme PAS `null` en `[]` (distinction legacy/base vide).
    expect(insulinTherapyService.replaceSlotSet).toHaveBeenCalledWith("isf", 7, SLOTS, 3, undefined, tx, { baseline: null })
  })

  it("acceptSetProposal : flip perdu (rejet/supersede concurrent, count 0) → notFound, PAS d'apply", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "insulinToCarbRatio", proposedSlots: SLOTS })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 0 })
    await expect(slotSetProposalService.acceptSetProposal("set-1", 7, 3)).rejects.toThrow("slotSetProposalNotFound")
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
  })

  it("acceptSetProposal : introuvable / hors périmètre → notFound, PAS d'apply", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue(null)
    await expect(slotSetProposalService.acceptSetProposal("set-x", 7, 3)).rejects.toThrow("slotSetProposalNotFound")
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
  })

  it("acceptSetProposal : mode basculé nonInsulin entre création et accept → nonInsulinNoDose, PAS d'apply (frontière MDR re-vérifiée)", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS })
    ;(treatmentModeService.resolveTreatmentMode as any).mockResolvedValueOnce({ mode: "nonInsulin" })
    await expect(slotSetProposalService.acceptSetProposal("set-1", 7, 3)).rejects.toThrow("nonInsulinNoDose")
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
    expect(auditService.logWithTx).not.toHaveBeenCalled()
  })

  it("acceptSetProposal : échec clinique de replaceSlotSet → propagé (fail-closed, rollback du flip)", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "insulinToCarbRatio", proposedSlots: SLOTS })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })
    ;(insulinTherapyService.replaceSlotSet as any).mockRejectedValueOnce(new Error("valueOutOfBounds"))
    await expect(slotSetProposalService.acceptSetProposal("set-1", 7, 3)).rejects.toThrow("valueOutOfBounds")
    // L'audit accepted n'est PAS émis (la transaction est rollback en réalité).
    expect(auditService.logWithTx).not.toHaveBeenCalled()
  })

  // ── reject ──────────────────────────────────────────────────────────────
  it("rejectSetProposal : marque rejected + audit", async () => {
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })
    const res = await slotSetProposalService.rejectSetProposal("set-1", 7, 3)
    expect(res).toEqual({ id: "set-1", status: "rejected" })
    expect(tx.slotSetProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "set-1", patientId: 7, status: "pending", patient: { deletedAt: null } } }),
    )
    expect(auditService.logWithTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "PROPOSAL_REJECTED", resource: "SLOT_SET_PROPOSAL", resourceId: "set-1" }),
    )
  })

  it("rejectSetProposal : rien à rejeter (scoping) → slotSetProposalNotFound", async () => {
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 0 })
    await expect(slotSetProposalService.rejectSetProposal("set-x", 7, 3)).rejects.toThrow("slotSetProposalNotFound")
    expect(auditService.logWithTx).not.toHaveBeenCalled()
  })

  // ── list ────────────────────────────────────────────────────────────────
  it("listSetProposals : retourne les propositions + audite le READ", async () => {
    prismaMock.slotSetProposal.findMany.mockResolvedValue([{ id: "set-1" }] as never)
    const res = await slotSetProposalService.listSetProposals(7, 3, "pending")
    expect(res).toEqual([{ id: "set-1" }])
    expect(prismaMock.slotSetProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ patientId: 7, patient: { deletedAt: null }, status: "pending" }) }),
    )
    // US-2663 (S0, revue archi) — le snapshot INTERNE `baselineSlots` n'est pas exposé sur la liste (minimisation).
    expect(prismaMock.slotSetProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ omit: { baselineSlots: true } }),
    )
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "READ", resource: "SLOT_SET_PROPOSAL", userId: 3 }),
    )
  })
})
