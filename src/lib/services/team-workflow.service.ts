/**
 * @module team-workflow.service
 * @description Groupe 3 — Équipe & Communication (workflow équipe soignante).
 *
 * Domaine couvert (10 US, ~10 SP) :
 *  - US-2078 MessageTemplate : bibliothèque de templates cabinet
 *  - US-2080 ReadReceipt     : tracking lecture (Announcement, etc.)
 *  - US-2065 ProposalAck     : accusé patient sur AdjustmentProposal
 *  - US-2066 ProposalActualization : vérif effective application
 *  - US-2068 ConsultationNote     : note structurée (chiffrée)
 *  - US-2072 TeleconsultActe      : lien facturation appointment
 *  - US-2083 DelegationRequest    : workflow IDE→DOCTOR
 *  - US-2084 MemberAbsence        : congé + couverture
 *  - US-2086 HandoffNote          : transfert annoté (chiffré)
 *  - US-2088 PatientGroup / PatientGroupAssignment : cohortes cabinet
 *
 * Conventions (post-reviews PR #388/389) :
 *  - Typed errors via `team-workflow.errors.ts` (pas de `Error("...")`).
 *  - US-2268 audit pattern : resourceId plat + metadata.patientId pivot.
 *  - Toutes les mutations passent par `prisma.$transaction` avec
 *    isolation `Serializable` quand il y a check+write.
 *  - Encryption AES-256-GCM (base64) pour les champs `content`/`note`
 *    susceptibles de contenir des PII cliniques.
 *  - Soft-delete patient (`deletedAt: null`) garanti au layer DB.
 */

import {
  Prisma,
  type DelegationRequestStatus,
  type PrismaClient,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./team-workflow.errors"

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0] | typeof prisma

async function assertServiceMember(
  userId: number,
  serviceId: number,
  tx: Tx = prisma,
): Promise<void> {
  const link = await tx.healthcareMember.findFirst({
    where: { userId, serviceId }, select: { id: true },
  })
  if (!link) throw new ForbiddenError()
}

async function assertPatientAlive(patientId: number, tx: Tx = prisma): Promise<void> {
  const p = await tx.patient.findFirst({
    where: { id: patientId, deletedAt: null }, select: { id: true },
  })
  if (!p) throw new NotFoundError()
}

// ─────────────────────────────────────────────────────────────
// US-2078 — Message templates (cabinet-scoped)
// ─────────────────────────────────────────────────────────────

const TEMPLATE_TITLE_MAX = 120
const TEMPLATE_BODY_MAX = 4096

export const messageTemplateService = {
  async list(serviceId: number, auditUserId: number, ctx?: AuditContext) {
    await assertServiceMember(auditUserId, serviceId)
    const items = await prisma.messageTemplate.findMany({
      where: { serviceId }, orderBy: { title: "asc" },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "MESSAGE_TEMPLATE",
      resourceId: String(serviceId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "list", serviceId, count: items.length },
    })
    return items
  },

  async create(
    input: { serviceId: number; title: string; body: string; variables?: string[] },
    auditUserId: number, ctx?: AuditContext,
  ) {
    if (!input.title.trim() || input.title.length > TEMPLATE_TITLE_MAX) {
      throw new ValidationError("title")
    }
    if (!input.body.trim() || input.body.length > TEMPLATE_BODY_MAX) {
      throw new ValidationError("body")
    }
    return prisma.$transaction(async (tx) => {
      await assertServiceMember(auditUserId, input.serviceId, tx)
      const tpl = await tx.messageTemplate.create({
        data: {
          serviceId: input.serviceId,
          title: input.title.trim(),
          body: input.body,
          variables: input.variables ?? [],
          createdBy: auditUserId,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "MESSAGE_TEMPLATE",
        resourceId: String(tpl.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { serviceId: input.serviceId },
      })
      return tpl
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async delete(id: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const tpl = await tx.messageTemplate.findUnique({
        where: { id }, select: { id: true, serviceId: true },
      })
      if (!tpl) throw new NotFoundError()
      await assertServiceMember(auditUserId, tpl.serviceId, tx)
      await tx.messageTemplate.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "MESSAGE_TEMPLATE",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { serviceId: tpl.serviceId },
      })
      return { deleted: true }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2080 — Read receipts (generic over `resource` + `resourceId`)
// ─────────────────────────────────────────────────────────────

const ALLOWED_READ_RESOURCES = new Set(["ANNOUNCEMENT", "DELEGATION_REQUEST", "HANDOFF_NOTE"])

export const readReceiptService = {
  async markRead(
    resource: string, resourceId: number, auditUserId: number, ctx?: AuditContext,
  ) {
    if (!ALLOWED_READ_RESOURCES.has(resource)) throw new ValidationError("resource")
    // Idempotent upsert : `(resource, resourceId, userId)` unique.
    const r = await prisma.readReceipt.upsert({
      where: {
        resource_resourceId_userId: { resource, resourceId, userId: auditUserId },
      },
      create: { resource, resourceId, userId: auditUserId },
      update: {}, // no-op : already read
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "READ_RECEIPT",
      resourceId: `${resource}:${resourceId}`,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { resource, resourceId, receiptId: r.id },
    })
    return { readAt: r.readAt }
  },

  async listReadersFor(resource: string, resourceId: number) {
    if (!ALLOWED_READ_RESOURCES.has(resource)) throw new ValidationError("resource")
    return prisma.readReceipt.findMany({
      where: { resource, resourceId },
      orderBy: { readAt: "asc" },
      select: { userId: true, readAt: true },
    })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2065 — Patient acknowledgement of an AdjustmentProposal
// ─────────────────────────────────────────────────────────────

export const proposalAckService = {
  async markRead(proposalId: string, patientId: number, ctx?: AuditContext) {
    const ack = await prisma.adjustmentProposalAck.upsert({
      where: { proposalId },
      create: { proposalId, patientId, acknowledged: true, readAt: new Date() },
      update: { acknowledged: true, readAt: new Date() },
    })
    await auditService.log({
      userId: null, // côté patient app (VIEWER); l'API route renseignera si dispo.
      action: "READ", resource: "PROPOSAL_ACK", resourceId: proposalId,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, proposalId, kind: "read" },
    })
    return ack
  },

  async respond(
    proposalId: string, patientId: number,
    decision: { accepted: boolean; comment?: string },
    ctx?: AuditContext,
  ) {
    const encrypted = decision.comment ? encryptField(decision.comment) : null
    const ack = await prisma.adjustmentProposalAck.upsert({
      where: { proposalId },
      create: {
        proposalId, patientId,
        acknowledged: true, readAt: new Date(),
        accepted: decision.accepted, respondedAt: new Date(),
        comment: encrypted,
      },
      update: {
        accepted: decision.accepted, respondedAt: new Date(),
        comment: encrypted,
      },
    })
    await auditService.log({
      userId: null, action: "UPDATE", resource: "PROPOSAL_ACK",
      resourceId: proposalId,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, proposalId, accepted: decision.accepted, kind: "respond" },
    })
    return ack
  },

  async getForProposal(proposalId: string) {
    const ack = await prisma.adjustmentProposalAck.findUnique({ where: { proposalId } })
    if (!ack) return null
    return {
      ...ack,
      comment: ack.comment ? safeDecryptField(ack.comment) : null,
    }
  },
}

// ─────────────────────────────────────────────────────────────
// US-2066 — Real-world actualization of an adjustment proposal
// ─────────────────────────────────────────────────────────────

const ALLOWED_VERIFY_VIA = new Set(["device-sync", "manual-ps", "patient-confirmed"])

export const proposalActualizationService = {
  async record(
    proposalId: string,
    input: { verifiedVia: string; effectiveAt?: Date },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    if (!ALLOWED_VERIFY_VIA.has(input.verifiedVia)) {
      throw new ValidationError("verifiedVia")
    }
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.adjustmentProposal.findUnique({
        where: { id: proposalId }, select: { patientId: true },
      })
      if (!proposal) throw new NotFoundError()
      const row = await tx.adjustmentProposalActualization.upsert({
        where: { proposalId },
        create: {
          proposalId,
          verifiedVia: input.verifiedVia,
          effectiveAt: input.effectiveAt ?? new Date(),
          verifiedBy: input.verifiedVia === "device-sync" ? null : auditUserId,
        },
        update: {
          verifiedVia: input.verifiedVia,
          effectiveAt: input.effectiveAt ?? new Date(),
          verifiedBy: input.verifiedVia === "device-sync" ? null : auditUserId,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "PROPOSAL_ACTUALIZATION",
        resourceId: proposalId,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: proposal.patientId,
          proposalId, verifiedVia: input.verifiedVia,
        },
      })
      return row
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2068 — Consultation notes (encrypted)
// ─────────────────────────────────────────────────────────────

const NOTE_MAX_LEN = 8192

export const consultationNoteService = {
  async create(
    input: {
      patientId: number
      authorId: number
      appointmentId?: number
      content: string
      category?: string
    },
    ctx?: AuditContext,
  ) {
    if (!input.content.trim() || input.content.length > NOTE_MAX_LEN) {
      throw new ValidationError("content")
    }
    return prisma.$transaction(async (tx) => {
      await assertPatientAlive(input.patientId, tx)
      const row = await tx.consultationNote.create({
        data: {
          patientId: input.patientId,
          authorId: input.authorId,
          appointmentId: input.appointmentId,
          content: encryptField(input.content),
          category: input.category,
        },
      })
      await auditService.logWithTx(tx, {
        userId: input.authorId, action: "CREATE", resource: "CONSULTATION_NOTE",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: input.patientId, hasAppointment: !!input.appointmentId },
      })
      return { id: row.id, createdAt: row.createdAt }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async listForPatient(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const rows = await prisma.consultationNote.findMany({
      where: { patientId, patient: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "CONSULTATION_NOTE",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "list", count: rows.length },
    })
    return rows.map((r) => ({
      id: r.id, patientId: r.patientId, authorId: r.authorId,
      appointmentId: r.appointmentId, category: r.category,
      content: safeDecryptField(r.content),
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }))
  },
}

// ─────────────────────────────────────────────────────────────
// US-2072 — Teleconsultation billing acte
// ─────────────────────────────────────────────────────────────

const BILLING_CODE_RE = /^[A-Z0-9]{2,20}$/

export const teleconsultActeService = {
  async create(
    input: { appointmentId: number; billingCode: string; amountCents?: number },
    auditUserId: number, ctx?: AuditContext,
  ) {
    if (!BILLING_CODE_RE.test(input.billingCode)) {
      throw new ValidationError("billingCode")
    }
    if (input.amountCents !== undefined && (input.amountCents < 0 || input.amountCents > 1_000_000)) {
      throw new ValidationError("amountCents")
    }
    return prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id: input.appointmentId },
        select: { id: true, patientId: true },
      })
      if (!appointment) throw new NotFoundError()
      const row = await tx.teleconsultationActe.create({
        data: {
          appointmentId: input.appointmentId,
          billingCode: input.billingCode,
          amountCents: input.amountCents,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "TELECONSULT_ACTE",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: appointment.patientId,
          appointmentId: input.appointmentId, billingCode: input.billingCode,
        },
      })
      return row
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async markInvoiced(id: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const acte = await tx.teleconsultationActe.findUnique({
        where: { id }, include: { appointment: { select: { patientId: true } } },
      })
      if (!acte) throw new NotFoundError()
      const updated = await tx.teleconsultationActe.update({
        where: { id },
        data: { invoicedAt: new Date(), invoicedBy: auditUserId },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "TELECONSULT_ACTE",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: acte.appointment.patientId,
          billingCode: acte.billingCode, kind: "invoiced",
        },
      })
      return updated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2083 — Delegation requests (IDE → DOCTOR)
// ─────────────────────────────────────────────────────────────

export const delegationRequestService = {
  async create(
    input: {
      patientId: number; fromUserId: number; toUserId: number;
      action: string; payload?: Prisma.InputJsonValue;
    },
    ctx?: AuditContext,
  ) {
    if (!input.action.trim() || input.action.length > 80) {
      throw new ValidationError("action")
    }
    return prisma.$transaction(async (tx) => {
      await assertPatientAlive(input.patientId, tx)
      const row = await tx.delegationRequest.create({
        data: {
          patientId: input.patientId,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          action: input.action.trim(),
          payload: input.payload ?? Prisma.JsonNull,
        },
      })
      await auditService.logWithTx(tx, {
        userId: input.fromUserId, action: "CREATE", resource: "DELEGATION_REQUEST",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: input.patientId, toUserId: input.toUserId, action: input.action },
      })
      return row
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async respond(
    id: number, reviewerId: number,
    decision: { status: Extract<DelegationRequestStatus, "approved" | "rejected">; reason?: string },
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const req = await tx.delegationRequest.findUnique({
        where: { id }, select: { id: true, toUserId: true, status: true, patientId: true },
      })
      if (!req) throw new NotFoundError()
      if (req.toUserId !== reviewerId) throw new ForbiddenError()
      if (req.status !== "pending") throw new ValidationError("alreadyReviewed")

      const updated = await tx.delegationRequest.update({
        where: { id },
        data: {
          status: decision.status,
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reason: decision.reason?.slice(0, 500),
        },
      })
      await auditService.logWithTx(tx, {
        userId: reviewerId,
        action: decision.status === "approved" ? "PROPOSAL_ACCEPTED" : "PROPOSAL_REJECTED",
        resource: "DELEGATION_REQUEST", resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: req.patientId, status: decision.status },
      })
      return updated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async listInbox(toUserId: number, ctx?: AuditContext) {
    const items = await prisma.delegationRequest.findMany({
      where: { toUserId, status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    await auditService.log({
      userId: toUserId, action: "READ", resource: "DELEGATION_REQUEST",
      resourceId: "inbox",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { toUserId, count: items.length },
    })
    return items
  },
}

// ─────────────────────────────────────────────────────────────
// US-2084 — Member absences + cover
// ─────────────────────────────────────────────────────────────

export const memberAbsenceService = {
  async create(
    input: {
      memberId: number; startDate: Date; endDate: Date;
      coverMemberId?: number; reason?: string;
    },
    auditUserId: number, ctx?: AuditContext,
  ) {
    if (input.endDate < input.startDate) throw new ValidationError("dateRange")
    return prisma.$transaction(async (tx) => {
      const member = await tx.healthcareMember.findUnique({
        where: { id: input.memberId }, select: { id: true, serviceId: true },
      })
      if (!member || member.serviceId === null) throw new NotFoundError()
      await assertServiceMember(auditUserId, member.serviceId, tx)
      const row = await tx.memberAbsence.create({
        data: {
          memberId: input.memberId,
          startDate: input.startDate,
          endDate: input.endDate,
          coverMemberId: input.coverMemberId,
          reason: input.reason?.slice(0, 120),
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "MEMBER_ABSENCE",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          memberId: input.memberId, serviceId: member.serviceId,
          coverMemberId: input.coverMemberId ?? null,
        },
      })
      return row
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async listForMember(memberId: number) {
    return prisma.memberAbsence.findMany({
      where: { memberId },
      orderBy: { startDate: "desc" },
      take: 50,
    })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2086 — Handoff notes (encrypted)
// ─────────────────────────────────────────────────────────────

const HANDOFF_MAX_LEN = 4096

export const handoffNoteService = {
  async create(
    input: { patientId: number; fromUserId: number; toUserId: number; note: string },
    ctx?: AuditContext,
  ) {
    if (!input.note.trim() || input.note.length > HANDOFF_MAX_LEN) {
      throw new ValidationError("note")
    }
    return prisma.$transaction(async (tx) => {
      await assertPatientAlive(input.patientId, tx)
      const row = await tx.handoffNote.create({
        data: {
          patientId: input.patientId,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          note: encryptField(input.note),
        },
      })
      await auditService.logWithTx(tx, {
        userId: input.fromUserId, action: "CREATE", resource: "HANDOFF_NOTE",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: input.patientId, toUserId: input.toUserId },
      })
      return { id: row.id, createdAt: row.createdAt }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async acknowledge(id: number, userId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const h = await tx.handoffNote.findUnique({
        where: { id }, select: { id: true, toUserId: true, patientId: true, acknowledgedAt: true },
      })
      if (!h) throw new NotFoundError()
      if (h.toUserId !== userId) throw new ForbiddenError()
      if (h.acknowledgedAt) return { acknowledgedAt: h.acknowledgedAt }
      const updated = await tx.handoffNote.update({
        where: { id }, data: { acknowledgedAt: new Date() },
      })
      await auditService.logWithTx(tx, {
        userId, action: "UPDATE", resource: "HANDOFF_NOTE",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: h.patientId, kind: "ack" },
      })
      return { acknowledgedAt: updated.acknowledgedAt }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async listInbox(toUserId: number) {
    const items = await prisma.handoffNote.findMany({
      where: { toUserId, acknowledgedAt: null, patient: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    return items.map((h) => ({ ...h, note: safeDecryptField(h.note) }))
  },
}

// ─────────────────────────────────────────────────────────────
// US-2088 — Patient groups (cohorts) + assignment
// ─────────────────────────────────────────────────────────────

const GROUP_LABEL_MAX = 80

export const patientGroupService = {
  async listForService(serviceId: number, auditUserId: number, ctx?: AuditContext) {
    await assertServiceMember(auditUserId, serviceId)
    const items = await prisma.patientGroup.findMany({
      where: { serviceId }, orderBy: { label: "asc" },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT_GROUP",
      resourceId: String(serviceId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "list", serviceId, count: items.length },
    })
    return items
  },

  async create(
    input: { serviceId: number; label: string },
    auditUserId: number, ctx?: AuditContext,
  ) {
    const label = input.label.trim()
    if (!label || label.length > GROUP_LABEL_MAX) throw new ValidationError("label")
    return prisma.$transaction(async (tx) => {
      await assertServiceMember(auditUserId, input.serviceId, tx)
      const g = await tx.patientGroup.create({
        data: { serviceId: input.serviceId, label, createdBy: auditUserId },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "PATIENT_GROUP",
        resourceId: String(g.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { serviceId: input.serviceId },
      })
      return g
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async setForPatient(
    patientId: number, groupIds: number[], auditUserId: number, ctx?: AuditContext,
  ) {
    const unique = Array.from(new Set(groupIds))
    return prisma.$transaction(async (tx) => {
      await assertPatientAlive(patientId, tx)
      if (unique.length > 0) {
        const memberServices = await tx.healthcareMember.findMany({
          where: { userId: auditUserId, serviceId: { not: null } },
          select: { serviceId: true },
        })
        const memberSet = new Set(
          memberServices.map((m) => m.serviceId).filter((s): s is number => s !== null),
        )
        const groups = await tx.patientGroup.findMany({
          where: { id: { in: unique }, serviceId: { in: Array.from(memberSet) } },
          select: { id: true },
        })
        if (groups.length !== unique.length) throw new ForbiddenError()
      }
      await tx.patientGroupAssignment.deleteMany({ where: { patientId } })
      if (unique.length > 0) {
        await tx.patientGroupAssignment.createMany({
          data: unique.map((groupId) => ({ patientId, groupId, assignedBy: auditUserId })),
          skipDuplicates: true,
        })
      }
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "PATIENT_GROUP_ASSIGNMENT",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, groupIds: unique },
      })
      return { count: unique.length }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async listForPatient(patientId: number) {
    const assignments = await prisma.patientGroupAssignment.findMany({
      where: { patientId, patient: { deletedAt: null } },
      include: { group: true },
      orderBy: { group: { label: "asc" } },
    })
    return assignments.map((a) => a.group)
  },
}
