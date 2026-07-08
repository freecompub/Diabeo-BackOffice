/**
 * US-2657 (slice C3a) — Service des **propositions d'ENSEMBLE de créneaux**.
 *
 * Représente une édition de groupe (valeurs et/ou restructuration) soumise par un patient EXPERT mais
 * NON auto-applicable (hors enveloppe ou structurelle) : stockée en bloc pour revue MÉDECIN. Comble
 * l'absence de « proposition de disposition entière » (l'`AdjustmentProposal` étant par-valeur).
 *
 * Invariant : **une seule proposition d'ensemble PENDING par (patient × paramètre)** — une nouvelle
 * soumission supersède la précédente en attente. Accepter applique en bloc via `replaceSlotSet`.
 * L'authz (rôle/portefeuille) est portée par les routes (C3c patient / C3d médecin) ; ce service est scopé patient.
 */
import type { ProposalStatus } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { auditService, type AuditContext } from "@/lib/services/audit.service"

/** Créneau proposé (forme du JSON `proposedSlots`). */
export type ProposedSlot = { startHour: number; endHour: number; value: number; mealLabel?: string }

/** Paramètres à jeu de créneaux gérés (ISF/ICR). */
export type SlotSetParam = "insulinSensitivityFactor" | "insulinToCarbRatio"

const REPLACE_KEY: Record<SlotSetParam, "isf" | "icr"> = {
  insulinSensitivityFactor: "isf",
  insulinToCarbRatio: "icr",
}

export const slotSetProposalService = {
  /**
   * Crée une proposition d'ensemble PENDING (supersède la précédente en attente sur le même paramètre).
   * @throws `emptySlotSet` si aucun créneau.
   */
  async createSetProposal(
    patientId: number,
    parameterType: SlotSetParam,
    proposedSlots: ProposedSlot[],
    proposedByUserId: number,
    ctx?: AuditContext,
  ) {
    if (!proposedSlots.length) throw new Error("emptySlotSet")
    return prisma.$transaction(async (tx) => {
      // Une seule PENDING par (patient × paramètre) : la précédente est superseded.
      await tx.slotSetProposal.updateMany({
        where: { patientId, parameterType, status: "pending" },
        data: { status: "superseded" },
      })
      const proposal = await tx.slotSetProposal.create({
        data: { patientId, parameterType, proposedSlots, proposedByUserId, status: "pending" },
        select: { id: true },
      })
      await auditService.logWithTx(tx, {
        userId: proposedByUserId,
        action: "CREATE",
        resource: "ADJUSTMENT_PROPOSAL",
        resourceId: proposal.id,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { patientId, kind: "slotSetProposalCreated", parameterType, slots: proposedSlots.length },
      })
      return { id: proposal.id }
    })
  },

  /**
   * **Accepte** une proposition d'ensemble (acte MÉDECIN — gate à la route) : applique la disposition en
   * bloc via `replaceSlotSet`, marque `accepted`. Scopé patient (anti-IDOR).
   * @throws `slotSetProposalNotFound` si absente/non pending/hors périmètre.
   */
  async acceptSetProposal(id: string, patientId: number, reviewerUserId: number, ctx?: AuditContext) {
    const proposal = await prisma.slotSetProposal.findFirst({
      where: { id, patientId, status: "pending" },
      select: { parameterType: true, proposedSlots: true },
    })
    if (!proposal) throw new Error("slotSetProposalNotFound")

    const param = proposal.parameterType as SlotSetParam
    const slots = proposal.proposedSlots as unknown as ProposedSlot[]
    // Applique en bloc (replaceSlotSet audite le remplacement + supersède les AdjustmentProposal pending).
    await insulinTherapyService.replaceSlotSet(REPLACE_KEY[param], patientId, slots, reviewerUserId, ctx)

    await prisma.slotSetProposal.update({
      where: { id },
      data: { status: "accepted", reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
    })
    await auditService.log({
      userId: reviewerUserId,
      action: "PROPOSAL_ACCEPTED",
      resource: "ADJUSTMENT_PROPOSAL",
      resourceId: id,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, kind: "slotSetProposalAccepted", parameterType: param },
    })
    return { id, status: "accepted" as const }
  },

  /**
   * **Rejette** une proposition d'ensemble (acte MÉDECIN — gate à la route). Scopé patient.
   * @throws `slotSetProposalNotFound` si absente/non pending/hors périmètre.
   */
  async rejectSetProposal(id: string, patientId: number, reviewerUserId: number, ctx?: AuditContext) {
    const res = await prisma.slotSetProposal.updateMany({
      where: { id, patientId, status: "pending" },
      data: { status: "rejected", reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
    })
    if (res.count === 0) throw new Error("slotSetProposalNotFound")
    await auditService.log({
      userId: reviewerUserId,
      action: "PROPOSAL_REJECTED",
      resource: "ADJUSTMENT_PROPOSAL",
      resourceId: id,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, kind: "slotSetProposalRejected" },
    })
    return { id, status: "rejected" as const }
  },

  /** Liste les propositions d'ensemble d'un patient (option : filtrer par statut). */
  async listSetProposals(patientId: number, status?: ProposalStatus) {
    return prisma.slotSetProposal.findMany({
      where: { patientId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
    })
  },
}
