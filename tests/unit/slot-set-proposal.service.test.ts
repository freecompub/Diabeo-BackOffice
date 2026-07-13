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
      // US-2663 (S3c) — voie POMPE de l'acceptation groupée (routage `basalRate`).
      replacePumpSlotSet: vi.fn().mockResolvedValue({
        applied: true,
        count: 2,
        coverage: { hasGap: false, hasOverlap: false },
        supersededProposalIds: [],
        supersededSetProposalIds: [],
      }),
      // US-2663 (S3d) — voie DOSE FIXE de l'acceptation groupée (routage `fixedDose`).
      replaceFixedDoseSet: vi.fn().mockResolvedValue({
        applied: true,
        count: 2,
        supersededProposalIds: [],
        supersededSetProposalIds: [],
      }),
      // US-2663 (S3d) — lecteur de base fixedDose (captureBaselineSlots). Défaut = pas de doses (base vide).
      getFixedDoseSlots: vi.fn().mockResolvedValue([]),
      // US-2663 (S3e) — voie BASALE STYLO de l'acceptation groupée + lecteur de base.
      replaceStyloBasalSet: vi.fn().mockResolvedValue({ applied: true, count: 2, supersededProposalIds: [], supersededSetProposalIds: [] }),
      getStyloBasalSlots: vi.fn().mockResolvedValue([]),
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
// Jeu POMPE VALIDE (US-2663 S3c) : couverture 24 h "HH:MM", débits délivrables (multiples 0,05) ∈ [0,05 ; 5,0].
const PUMP_SLOTS = [
  { startTime: "00:00", endTime: "06:00", rate: 0.8 },
  { startTime: "06:00", endTime: "00:00", rate: 1.1 },
]
const PUMP_BASE = [
  { startTime: "00:00", endTime: "06:00", rate: 0.85 },
  { startTime: "06:00", endTime: "00:00", rate: 1.1 },
]
// Jeu DOSE FIXE VALIDE (US-2663 S3d) : clé (usage, moment), valeurs délivrables ≥ 0,5 U.
const FIXED_SLOTS = [
  { usage: "bolus", moment: "morning", value: 6 },
  { usage: "basal", moment: "evening", value: 20 },
]
const FIXED_BASE = [
  { usage: "bolus", moment: "morning", value: 5 },
  { usage: "basal", moment: "evening", value: 20 },
]
// Jeu BASALE STYLO VALIDE (US-2663 S3e) : split cohérent {morning, evening}, U TOTALES délivrables.
const STYLO_SLOTS = [
  { kind: "morning", value: 12 },
  { kind: "evening", value: 10 },
]
const STYLO_BASE = [
  { kind: "morning", value: 10 },
  { kind: "evening", value: 10 },
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
    // Config ISF ACTIVE = mêmes créneaux que la soumission (un patient édite sa config, il ne restructure pas —
    // garde S4 `structuralChangeNotAllowed`). Valeurs identiques → aucun changement (pas de cap déclenché).
    prismaMock.insulinSensitivityFactor.findMany.mockResolvedValue([
      { startHour: 0, endHour: 8, sensitivityFactorGl: 0.5 },
      { startHour: 8, endHour: 22, sensitivityFactorGl: 0.45 },
      { startHour: 22, endHour: 0, sensitivityFactorGl: 0.4 },
    ] as never)
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })
    tx.slotSetProposal.create.mockResolvedValue({ id: "set-1" })

    const res = await slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: 7, source: "patient" } })
    expect(res).toEqual({ id: "set-1" })
    // US-2663 (S3b-0a / D2) — source=patient (HUMAIN) → supersède les pending d'origine HUMAINE (`source != algorithm`),
    // pas l'algorithme (coexistence). Filtre appliqué aux deux modèles.
    expect(tx.slotSetProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientId: 7, parameterType: "insulinSensitivityFactor", status: "pending", source: { not: "algorithm" } }, data: { status: "superseded" } }),
    )
    expect(tx.adjustmentProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientId: 7, parameterType: "insulinSensitivityFactor", status: "pending", source: { not: "algorithm" } } }),
    )
    expect(auditService.logWithTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "CREATE", resource: "SLOT_SET_PROPOSAL", resourceId: "set-1" }),
    )
  })

  it("createSetProposal (US-2663 S0) : snapshot baseline ISF ACTIF + source=patient persistés", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    // Config ISF active du patient (g/L·U = sensitivityFactorGl) → baseline attendu, même encodage que proposedSlots.
    // Mêmes créneaux que SLOTS (garde S4 anti-restructuration) ; valeurs proches (< 10 %) → capture testée sans cap.
    prismaMock.insulinSensitivityFactor.findMany.mockResolvedValue([
      { startHour: 0, endHour: 8, sensitivityFactorGl: 0.52 },
      { startHour: 8, endHour: 22, sensitivityFactorGl: 0.47 },
      { startHour: 22, endHour: 0, sensitivityFactorGl: 0.42 },
    ] as never)
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 0 })
    tx.slotSetProposal.create.mockResolvedValue({ id: "set-1" })

    await slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: 7, source: "patient" } })

    expect(tx.slotSetProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "patient",
          proposedSlots: SLOTS,
          baselineSlots: [
            { startHour: 0, endHour: 8, value: 0.52 },
            { startHour: 8, endHour: 22, value: 0.47 },
            { startHour: 22, endHour: 0, value: 0.42 },
          ],
        }),
      }),
    )
    // L'audit de création trace la provenance + les deux tailles (forensics).
    expect(auditService.logWithTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ metadata: expect.objectContaining({ source: "patient", baselineSlots: 3 }) }),
    )
  })

  it("createSetProposal (S3b-0a) : MOTEUR (source=algorithm, userId null) persiste source + rationale ; supersède l'ALGO seul", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 0 })
    tx.slotSetProposal.create.mockResolvedValue({ id: "set-2" })
    const rationale = [{ startHour: 0, reason: "isfTooLow" as const, confidence: "high" as const, supportingEvents: 12 }]

    await slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: null, source: "algorithm" }, rationale })

    expect(tx.slotSetProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "algorithm", proposedByUserId: null, baselineSlots: [], rationale }) }),
    )
    // D2 : l'algorithme supersède UNIQUEMENT l'algorithme (coexistence avec l'humain).
    expect(tx.slotSetProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ source: "algorithm" }) }),
    )
  })

  it("createSetProposal (S3b-0a) : MOTEUR SANS rationale → rationaleRequired (contrat serveur)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    await expect(
      slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: null, source: "algorithm" } }),
    ).rejects.toThrow("rationaleRequired")
  })

  it("createSetProposal (S3b-0a) : MOTEUR rationale VIDE ou MALFORMÉE → rationaleRequired", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    await expect(
      slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: null, source: "algorithm" }, rationale: [] }),
    ).rejects.toThrow("rationaleRequired")
    await expect(
      // Malformée : `reason` hors enum `AdjustmentReason`.
      slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: null, source: "algorithm" }, rationale: [{ startHour: 0, reason: "notAnEnum", confidence: null, supportingEvents: null }] as never }),
    ).rejects.toThrow("rationaleRequired")
  })

  it("createSetProposal (S3b-0a) : rationale passée par un HUMAIN est IGNORÉE (non persistée)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    // Baseline ISF alignée sur SLOTS (garde S4 anti-restructuration), valeurs identiques → pas de cap.
    prismaMock.insulinSensitivityFactor.findMany.mockResolvedValue([
      { startHour: 0, endHour: 8, sensitivityFactorGl: 0.5 },
      { startHour: 8, endHour: 22, sensitivityFactorGl: 0.45 },
      { startHour: 22, endHour: 0, sensitivityFactorGl: 0.4 },
    ] as never)
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 0 })
    tx.slotSetProposal.create.mockResolvedValue({ id: "set-h" })
    const rationale = [{ startHour: 0, reason: "isfTooLow" as const, confidence: "high" as const, supportingEvents: 12 }]

    await slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: 7, source: "patient" }, rationale })

    // La rationale d'un humain n'est jamais écrite (champ omis → NULL).
    const data = tx.slotSetProposal.create.mock.calls[0]![0].data
    expect(data.rationale).toBeUndefined()
  })

  it("createSetProposal (S3b-0a) : parité identité — algorithme AVEC userId, ou humain SANS userId → invalidProposerIdentity", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    await expect(
      slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: 5, source: "algorithm" }, rationale: [{ startHour: 0, reason: "isfTooLow" as const, confidence: null, supportingEvents: null }] }),
    ).rejects.toThrow("invalidProposerIdentity")
    await expect(
      slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: null, source: "patient" } }),
    ).rejects.toThrow("invalidProposerIdentity")
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

    await slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinToCarbRatio", proposedSlots: ICR_SLOTS, proposer: { userId: 7, source: "patient" } })

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
    await expect(slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: [], proposer: { userId: 7, source: "patient" } })).rejects.toThrow("emptySlotSet")
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled()
  })

  it("createSetProposal : valeur ISF hors bornes → valueOutOfBounds DÈS la création (M6)", async () => {
    const bad = [{ startHour: 0, endHour: 12, value: 5.0 }, { startHour: 12, endHour: 0, value: 0.5 }] // 5.0 > ISF_GL_MAX
    await expect(slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: bad, proposer: { userId: 7, source: "patient" } })).rejects.toThrow("valueOutOfBounds")
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled()
  })

  it("createSetProposal : patient soft-deleted / inexistant → patientNotFound", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null as never)
    await expect(slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: 7, source: "patient" } })).rejects.toThrow("patientNotFound")
    expect(treatmentModeService.resolveTreatmentMode).not.toHaveBeenCalled()
  })

  it("createSetProposal : patient NON INSULINÉ → nonInsulinNoDose (frontière MDR, aucune écriture)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    ;(treatmentModeService.resolveTreatmentMode as any).mockResolvedValueOnce({ mode: "nonInsulin" })
    await expect(slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: 7, source: "patient" } })).rejects.toThrow("nonInsulinNoDose")
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("createSetProposal : P2002 (forme Prisma 7 + adapter-pg) → duplicatePendingProposal", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    // Baseline ISF alignée sur SLOTS (garde S4 anti-restructuration) → on atteint bien le chemin de création (P2002).
    prismaMock.insulinSensitivityFactor.findMany.mockResolvedValue([
      { startHour: 0, endHour: 8, sensitivityFactorGl: 0.5 },
      { startHour: 8, endHour: 22, sensitivityFactorGl: 0.45 },
      { startHour: 22, endHour: 0, sensitivityFactorGl: 0.4 },
    ] as never)
    // Forme RÉELLE sous @prisma/adapter-pg : meta.target = undefined ; le nom de contrainte est dans
    // driverAdapterError.cause.originalMessage (cf. review prisma-specialist).
    prismaMock.$transaction.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: {
          driverAdapterError: {
            cause: {
              originalMessage: 'duplicate key value violates unique constraint "slot_set_proposals_one_pending_per_param_origin"',
              constraint: { fields: ["patient_id", "parameter_type"] },
            },
          },
        },
      }) as never,
    )
    await expect(slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: 7, source: "patient" } })).rejects.toThrow("duplicatePendingProposal")
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

  it("createSetProposal (S3d) : fixedDose valide → crée + capture la base via getFixedDoseSlots", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    ;(insulinTherapyService.getFixedDoseSlots as any).mockResolvedValueOnce([{ usage: "bolus", moment: "morning", value: 5 }])
    const tx = mockTx()
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 0 })
    tx.slotSetProposal.create.mockResolvedValue({ id: "set-f" })

    // Provenance PRO (doctor) : la dose fixe groupée est une voie soignant/moteur (les patients ne soumettent
    // que ISF/ICR/basale — route `PUT /api/patient/insulin-slot-set`). Un pro n'est PAS gaté (US-2663 S4).
    const res = await slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "fixedDose", proposedSlots: FIXED_SLOTS as never, proposer: { userId: 3, source: "doctor" } })
    expect(res).toEqual({ id: "set-f" })
    expect(insulinTherapyService.getFixedDoseSlots).toHaveBeenCalledWith(7)
    expect(tx.slotSetProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parameterType: "fixedDose", proposedSlots: FIXED_SLOTS, baselineSlots: [{ usage: "bolus", moment: "morning", value: 5 }] }) }),
    )
  })

  it("createSetProposal (S3d) : fixedDose de forme invalide (usage manquant) → invalidSlotSet", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as never)
    await expect(
      slotSetProposalService.createSetProposal({ patientId: 7, parameterType: "fixedDose", proposedSlots: [{ moment: "morning", value: 6 }] as never, proposer: { userId: 7, source: "patient" } }),
    ).rejects.toThrow("invalidSlotSet")
  })

  // ── accept POMPE (US-2663 S3c) ────────────────────────────────────────────
  it("acceptSetProposal (S3c) : basalRate POMPE → route replacePumpSlotSet(tx, {baseline}) (PAS replaceSlotSet)", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "basalRate", proposedSlots: PUMP_SLOTS, baselineSlots: PUMP_BASE })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })

    const res = await slotSetProposalService.acceptSetProposal("set-p", 7, 3)
    expect(res).toEqual({ id: "set-p", status: "accepted" })
    // Routage POMPE : apply DANS la transaction (`tx` 5e arg) + `expectedBaseline` (7e). replaceSlotSet ISF/ICR JAMAIS appelé.
    expect(insulinTherapyService.replacePumpSlotSet).toHaveBeenCalledWith(7, PUMP_SLOTS, 3, undefined, tx, { baseline: PUMP_BASE })
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
    expect(auditService.logWithTx).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "PROPOSAL_ACCEPTED", metadata: expect.objectContaining({ parameterType: "basalRate" }) }))
  })

  it("acceptSetProposal (S3e) : basalRate de forme MIXTE pompe+stylo → unsupportedSlotSetParam, PAS d'apply", async () => {
    const tx = mockTx()
    // Un jeu `basalRate` MÉLANGEANT pompe (`startTime`) et stylo (`kind`) est incohérent → fail-closed (S3e).
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "basalRate", proposedSlots: [{ startTime: "00:00", endTime: "06:00", rate: 0.8 }, { kind: "daily", value: 20 }], baselineSlots: null })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })
    await expect(slotSetProposalService.acceptSetProposal("set-p", 7, 3)).rejects.toThrow(/invalidSlotSet|unsupportedSlotSetParam/)
    expect(insulinTherapyService.replacePumpSlotSet).not.toHaveBeenCalled()
    expect(insulinTherapyService.replaceStyloBasalSet).not.toHaveBeenCalled()
  })

  it("acceptSetProposal (S3c) : configType basculé STYLO à l'accept → basalConfigNotPump propagé (rollback, pas d'audit)", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "basalRate", proposedSlots: PUMP_SLOTS, baselineSlots: PUMP_BASE })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })
    // replacePumpSlotSet re-garde le configType LIVE → lève basalConfigNotPump si patient devenu stylo.
    ;(insulinTherapyService.replacePumpSlotSet as any).mockRejectedValueOnce(new Error("basalConfigNotPump"))
    await expect(slotSetProposalService.acceptSetProposal("set-p", 7, 3)).rejects.toThrow("basalConfigNotPump")
    expect(auditService.logWithTx).not.toHaveBeenCalled() // rollback → jamais « accepté » fantôme
  })

  it("acceptSetProposal (S3c) : CAS d'ensemble pompe rejeté (baselineMoved) → propagé (fail-closed)", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "basalRate", proposedSlots: PUMP_SLOTS, baselineSlots: PUMP_BASE })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })
    ;(insulinTherapyService.replacePumpSlotSet as any).mockRejectedValueOnce(new Error("baselineMoved"))
    await expect(slotSetProposalService.acceptSetProposal("set-p", 7, 3)).rejects.toThrow("baselineMoved")
    expect(auditService.logWithTx).not.toHaveBeenCalled()
  })

  // ── accept BASALE STYLO (US-2663 S3e) — même parameterType basalRate, discriminé par la FORME ──
  it("acceptSetProposal (S3e) : basalRate de forme STYLO (`kind`) → route replaceStyloBasalSet (PAS replacePumpSlotSet)", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "basalRate", proposedSlots: STYLO_SLOTS, baselineSlots: STYLO_BASE })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })

    const res = await slotSetProposalService.acceptSetProposal("set-s", 7, 3)
    expect(res).toEqual({ id: "set-s", status: "accepted" })
    expect(insulinTherapyService.replaceStyloBasalSet).toHaveBeenCalledWith(7, STYLO_SLOTS, 3, undefined, tx, { baseline: STYLO_BASE })
    expect(insulinTherapyService.replacePumpSlotSet).not.toHaveBeenCalled()
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
  })

  it("acceptSetProposal (S3e) : patient POMPE (config LIVE non stylo) → basalConfigNotStylo propagé (rollback, pas d'audit)", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "basalRate", proposedSlots: STYLO_SLOTS, baselineSlots: STYLO_BASE })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })
    ;(insulinTherapyService.replaceStyloBasalSet as any).mockRejectedValueOnce(new Error("basalConfigNotStylo"))
    await expect(slotSetProposalService.acceptSetProposal("set-s", 7, 3)).rejects.toThrow("basalConfigNotStylo")
    expect(auditService.logWithTx).not.toHaveBeenCalled()
  })

  // ── accept DOSE FIXE (US-2663 S3d) ────────────────────────────────────────
  it("acceptSetProposal (S3d) : fixedDose → route replaceFixedDoseSet(tx, {baseline}) (PAS replaceSlotSet/Pump)", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "fixedDose", proposedSlots: FIXED_SLOTS, baselineSlots: FIXED_BASE })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })

    const res = await slotSetProposalService.acceptSetProposal("set-f", 7, 3)
    expect(res).toEqual({ id: "set-f", status: "accepted" })
    expect(insulinTherapyService.replaceFixedDoseSet).toHaveBeenCalledWith(7, FIXED_SLOTS, 3, undefined, tx, { baseline: FIXED_BASE })
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
    expect(insulinTherapyService.replacePumpSlotSet).not.toHaveBeenCalled()
    expect(auditService.logWithTx).toHaveBeenCalledWith(tx, expect.objectContaining({ metadata: expect.objectContaining({ parameterType: "fixedDose" }) }))
  })

  it("acceptSetProposal (S3d) : jeu de forme non-fixedDose (sans usage) → unsupportedSlotSetParam, PAS d'apply", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "fixedDose", proposedSlots: [{ moment: "morning", value: 6 }], baselineSlots: null })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })
    // `{moment, value}` sans `usage` échoue le parse de forme fixedDose → invalidSlotSet (avant même la garde).
    await expect(slotSetProposalService.acceptSetProposal("set-f", 7, 3)).rejects.toThrow(/invalidSlotSet|unsupportedSlotSetParam/)
    expect(insulinTherapyService.replaceFixedDoseSet).not.toHaveBeenCalled()
  })

  it("acceptSetProposal (S3d) : résolution ambiguë (fixedDoseSlotAmbiguous) → propagé (rollback, pas d'audit)", async () => {
    const tx = mockTx()
    tx.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "fixedDose", proposedSlots: FIXED_SLOTS, baselineSlots: FIXED_BASE })
    tx.slotSetProposal.updateMany.mockResolvedValue({ count: 1 })
    ;(insulinTherapyService.replaceFixedDoseSet as any).mockRejectedValueOnce(new Error("fixedDoseSlotAmbiguous"))
    await expect(slotSetProposalService.acceptSetProposal("set-f", 7, 3)).rejects.toThrow("fixedDoseSlotAmbiguous")
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
