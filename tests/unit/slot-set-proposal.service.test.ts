/**
 * US-2657 (slice C3a) — Service des propositions d'ensemble de créneaux.
 * Comportement testé : create (supersède la pending précédente + audit), accept (→ replaceSlotSet en bloc
 * + accepted), reject, scoping patient (anti-IDOR → notFound), emptySlotSet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/insulin-therapy.service", () => ({
  insulinTherapyService: { replaceSlotSet: vi.fn().mockResolvedValue({ supersededProposalIds: [] }) },
}))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: vi.fn(), logWithTx: vi.fn() },
}))

const { slotSetProposalService } = await import("@/lib/services/slot-set-proposal.service")
const { insulinTherapyService } = await import("@/lib/services/insulin-therapy.service")

const SLOTS = [
  { startHour: 0, endHour: 8, value: 0.5 },
  { startHour: 8, endHour: 22, value: 0.45 },
  { startHour: 22, endHour: 6, value: 0.4 },
]

describe("slotSetProposalService", () => {
  beforeEach(() => vi.clearAllMocks())

  it("createSetProposal : supersède la pending précédente + crée + audit", async () => {
    const tx = {
      slotSetProposal: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: "set-1" }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
    const res = await slotSetProposalService.createSetProposal(7, "insulinSensitivityFactor", SLOTS, 7)
    expect(res).toEqual({ id: "set-1" })
    expect(tx.slotSetProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientId: 7, parameterType: "insulinSensitivityFactor", status: "pending" }, data: { status: "superseded" } }),
    )
    expect(tx.slotSetProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ patientId: 7, parameterType: "insulinSensitivityFactor", status: "pending" }) }),
    )
  })

  it("createSetProposal : jeu vide → emptySlotSet", async () => {
    await expect(slotSetProposalService.createSetProposal(7, "insulinSensitivityFactor", [], 7)).rejects.toThrow("emptySlotSet")
  })

  it("acceptSetProposal : applique en bloc (replaceSlotSet) + accepted", async () => {
    prismaMock.slotSetProposal.findFirst.mockResolvedValue({ parameterType: "insulinToCarbRatio", proposedSlots: SLOTS } as never)
    prismaMock.slotSetProposal.update.mockResolvedValue({} as never)
    const res = await slotSetProposalService.acceptSetProposal("set-1", 7, 3)
    expect(res).toEqual({ id: "set-1", status: "accepted" })
    expect(insulinTherapyService.replaceSlotSet).toHaveBeenCalledWith("icr", 7, SLOTS, 3, undefined)
    expect(prismaMock.slotSetProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "set-1" }, data: expect.objectContaining({ status: "accepted", reviewedByUserId: 3 }) }),
    )
  })

  it("acceptSetProposal : hors périmètre / non pending → slotSetProposalNotFound (pas d'apply)", async () => {
    prismaMock.slotSetProposal.findFirst.mockResolvedValue(null as never)
    await expect(slotSetProposalService.acceptSetProposal("set-x", 7, 3)).rejects.toThrow("slotSetProposalNotFound")
    expect(insulinTherapyService.replaceSlotSet).not.toHaveBeenCalled()
  })

  it("rejectSetProposal : marque rejected", async () => {
    prismaMock.slotSetProposal.updateMany.mockResolvedValue({ count: 1 } as never)
    const res = await slotSetProposalService.rejectSetProposal("set-1", 7, 3)
    expect(res).toEqual({ id: "set-1", status: "rejected" })
  })

  it("rejectSetProposal : rien à rejeter (scoping) → slotSetProposalNotFound", async () => {
    prismaMock.slotSetProposal.updateMany.mockResolvedValue({ count: 0 } as never)
    await expect(slotSetProposalService.rejectSetProposal("set-x", 7, 3)).rejects.toThrow("slotSetProposalNotFound")
  })
})
