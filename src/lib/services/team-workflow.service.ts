/**
 * @module team-workflow.service
 * @description Groupe 3 — Équipe & Communication (workflow équipe soignante).
 *
 * Domaine couvert (10 US, ~10 SP) :
 *  - US-2078 MessageTemplate
 *  - US-2080 ReadReceipt (générique)
 *  - US-2065 ProposalAck (patient)
 *  - US-2066 ProposalActualization
 *  - US-2068 ConsultationNote (chiffré)
 *  - US-2072 TeleconsultActe
 *  - US-2083 DelegationRequest
 *  - US-2084 MemberAbsence
 *  - US-2086 HandoffNote (chiffré)
 *  - US-2088 PatientGroup
 *
 * Conventions (post-reviews PR #388/389/390) :
 *  - Typed errors via `team-workflow.errors.ts`.
 *  - US-2268 audit pivot : `resourceId` plat + `metadata.patientId`.
 *  - C5 : actions `DELEGATION_APPROVED`/`REJECTED` distinctes de `PROPOSAL_*`.
 *  - H2 : `proposalAck.markRead/respond` propagent `auditUserId`.
 *  - H3 : `markInvoiced` rejette si déjà facturé.
 *  - H4 : `proposalActualization.record` rejette doublon `(proposalId)`.
 *  - H6 : `handoffNote.listInbox` audite + filtre `patientShareConsent`.
 *  - H7 : `memberAbsence.listForMember` check cabinet + audit.
 *  - H8 : `toUserId` (delegations + handoffs) vérifié membre du même cabinet.
 *  - H9 : `readReceipt.markRead` vérifie l'accès à la resource ciblée.
 *  - H11/H12 : typed `Prisma.InputJsonValue` + DTO returns sur respond.
 *  - M2 : `consultationNote.create` vérifie `appointment.patientId === patientId`.
 *  - M3 : `memberAbsence` → `ValidationError("memberHasNoService")` si serviceId null.
 *  - M4 : `setForPatient` n'utilise plus `skipDuplicates` après deleteMany.
 *  - M8 : `verifiedVia` typed literal union (pas `string`).
 *  - M9 : DTO returns pour `messageTemplate`, `patientGroup`, `teleconsultActe`, etc.
 *  - M11 : `delegationRequest.create` rejette self-delegation.
 *  - M14 : audit READ sur tous les listings PHI.
 *  - L1 : `ALLOWED_READ_RESOURCES` typed literal union.
 *  - L4 : `DelegationDecision` alias nommé.
 *  - L8 : `proposalAck.respond` length-check côté service.
 *
 *  Encryption AES-256-GCM (base64) sur `ConsultationNote.content`,
 *  `HandoffNote.note`, `ProposalAck.comment`.
 */

import {
  Prisma,
  type DelegationRequestStatus,
} from "@prisma/client"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./team-workflow.errors"

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

/**
 * H8 — Verify the target user belongs to a service that ALSO covers the patient
 * AND that the caller is a member of. Used by `delegations` and `handoffs` to
 * prevent sending workflow rows to arbitrary users.
 */
async function assertColleagueWithPatientAccess(
  fromUserId: number,
  toUserId: number,
  patientId: number,
  tx: Tx = prisma,
): Promise<void> {
  if (fromUserId === toUserId) throw new ValidationError("selfTarget") // M11
  const link = await tx.patientService.findFirst({
    where: {
      patientId,
      service: {
        members: { some: { userId: fromUserId } },
        AND: { members: { some: { userId: toUserId } } },
      },
    },
    select: { id: true },
  })
  if (!link) throw new ForbiddenError()
}

// ─────────────────────────────────────────────────────────────
// US-2078 — Message templates (cabinet-scoped)
// ─────────────────────────────────────────────────────────────

const TEMPLATE_TITLE_MAX = 120
const TEMPLATE_BODY_MAX = 4096

export type MessageTemplateDTO = {
  id: number
  serviceId: number
  title: string
  body: string
  variables: string[]
}
function toMessageTemplateDTO(t: {
  id: number; serviceId: number; title: string; body: string; variables: string[]
}): MessageTemplateDTO {
  return { id: t.id, serviceId: t.serviceId, title: t.title, body: t.body, variables: t.variables }
}

export const messageTemplateService = {
  async list(serviceId: number, auditUserId: number, ctx?: AuditContext): Promise<MessageTemplateDTO[]> {
    await assertServiceMember(auditUserId, serviceId)
    const items = await prisma.messageTemplate.findMany({
      where: { serviceId }, orderBy: { title: "asc" },
      select: { id: true, serviceId: true, title: true, body: true, variables: true },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "MESSAGE_TEMPLATE",
      resourceId: String(serviceId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "list", serviceId, count: items.length },
    })
    return items.map(toMessageTemplateDTO)
  },

  async create(
    input: { serviceId: number; title: string; body: string; variables?: string[] },
    auditUserId: number, ctx?: AuditContext,
  ): Promise<MessageTemplateDTO> {
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
        select: { id: true, serviceId: true, title: true, body: true, variables: true },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "MESSAGE_TEMPLATE",
        resourceId: String(tpl.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { serviceId: input.serviceId },
      })
      return toMessageTemplateDTO(tpl)
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
// US-2080 — Read receipts (typed literal resource set, L1)
// ─────────────────────────────────────────────────────────────

const ALLOWED_READ_RESOURCES = ["ANNOUNCEMENT", "DELEGATION_REQUEST", "HANDOFF_NOTE"] as const
type ReadReceiptResource = typeof ALLOWED_READ_RESOURCES[number]

function isAllowedReadResource(s: string): s is ReadReceiptResource {
  return (ALLOWED_READ_RESOURCES as readonly string[]).includes(s)
}

/**
 * H9 — verify the caller is the legitimate audience for the resource being
 * marked as read. Prevents cross-cabinet tampering on workflow rows.
 */
async function assertReadAccess(
  resource: ReadReceiptResource,
  resourceId: number,
  userId: number,
): Promise<void> {
  if (resource === "DELEGATION_REQUEST") {
    const row = await prisma.delegationRequest.findFirst({
      where: { id: resourceId, toUserId: userId }, select: { id: true },
    })
    if (!row) throw new ForbiddenError()
    return
  }
  if (resource === "HANDOFF_NOTE") {
    const row = await prisma.handoffNote.findFirst({
      where: { id: resourceId, toUserId: userId }, select: { id: true },
    })
    if (!row) throw new ForbiddenError()
    return
  }
  if (resource === "ANNOUNCEMENT") {
    const row = await prisma.announcement.findFirst({
      where: { id: resourceId }, select: { id: true },
    })
    if (!row) throw new NotFoundError()
    return
  }
}

export const readReceiptService = {
  async markRead(
    resource: string, resourceId: number, auditUserId: number, ctx?: AuditContext,
  ) {
    if (!isAllowedReadResource(resource)) throw new ValidationError("resource")
    await assertReadAccess(resource, resourceId, auditUserId)
    const r = await prisma.readReceipt.upsert({
      where: {
        resource_resourceId_userId: { resource, resourceId, userId: auditUserId },
      },
      create: { resource, resourceId, userId: auditUserId },
      update: {},
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "READ_RECEIPT",
      resourceId: String(r.id),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { resource, parentResourceId: resourceId },
    })
    return { readAt: r.readAt }
  },
}

// ─────────────────────────────────────────────────────────────
// US-2065 — Patient acknowledgement of an AdjustmentProposal
// ─────────────────────────────────────────────────────────────

const ACK_COMMENT_MAX = 500

export const proposalAckService = {
  async markRead(
    proposalId: string,
    patientId: number,
    auditUserId: number,         // H2 — propagated from route
    ctx?: AuditContext,
  ) {
    const ack = await prisma.adjustmentProposalAck.upsert({
      where: { proposalId },
      create: { proposalId, patientId, acknowledged: true, readAt: new Date() },
      update: { acknowledged: true, readAt: new Date() },
      select: { id: true, readAt: true },
    })
    await auditService.log({
      userId: auditUserId,
      action: "READ", resource: "PROPOSAL_ACK", resourceId: proposalId,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, proposalId, kind: "read" },
    })
    return ack
  },

  async respond(
    proposalId: string, patientId: number,
    decision: { accepted: boolean; comment?: string },
    auditUserId: number,         // H2
    ctx?: AuditContext,
  ) {
    // L8 — defensive length check at the service layer too.
    if (decision.comment && decision.comment.length > ACK_COMMENT_MAX) {
      throw new ValidationError("comment")
    }
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
      select: { id: true, accepted: true, respondedAt: true },
    })
    await auditService.log({
      userId: auditUserId,
      action: "UPDATE", resource: "PROPOSAL_ACK", resourceId: proposalId,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, proposalId, accepted: decision.accepted, kind: "respond" },
    })
    return ack
  },
}

// ─────────────────────────────────────────────────────────────
// US-2066 — Real-world actualization (H4 guard against overwrite, M8 literal)
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used via `typeof VERIFY_VIA_VALUES` in the type export below
const VERIFY_VIA_VALUES = ["device-sync", "manual-ps", "patient-confirmed"] as const
export type VerifyVia = typeof VERIFY_VIA_VALUES[number]

export const proposalActualizationService = {
  async record(
    proposalId: string,
    input: { verifiedVia: VerifyVia; effectiveAt?: Date },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.adjustmentProposal.findUnique({
        where: { id: proposalId }, select: { patientId: true },
      })
      if (!proposal) throw new NotFoundError()

      // H4 — refuse to silently overwrite a prior actualization. Allow re-record
      // only if same source (`device-sync` re-sync is idempotent and OK).
      const existing = await tx.adjustmentProposalActualization.findUnique({
        where: { proposalId }, select: { verifiedVia: true },
      })
      if (existing && existing.verifiedVia !== input.verifiedVia) {
        throw new ValidationError("alreadyActualized")
      }

      const row = await tx.adjustmentProposalActualization.upsert({
        where: { proposalId },
        create: {
          proposalId,
          verifiedVia: input.verifiedVia,
          effectiveAt: input.effectiveAt ?? new Date(),
          verifiedBy: input.verifiedVia === "device-sync" ? null : auditUserId,
        },
        update: {
          effectiveAt: input.effectiveAt ?? new Date(),
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: existing ? "UPDATE" : "CREATE",
        resource: "PROPOSAL_ACTUALIZATION",
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

  /**
   * Convenience for routes: returns the patient that owns a proposal (used by
   * the route to RBAC-check `canAccessPatient` before calling `record`).
   */
  async getProposalPatientId(proposalId: string): Promise<number | null> {
    const p = await prisma.adjustmentProposal.findUnique({
      where: { id: proposalId }, select: { patientId: true },
    })
    return p?.patientId ?? null
  },
}

// ─────────────────────────────────────────────────────────────
// US-2068 — Consultation notes (M2 verify appointment ownership)
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
      // M2 — verify the linked appointment actually belongs to the patient.
      if (input.appointmentId !== undefined) {
        const appt = await tx.appointment.findFirst({
          where: { id: input.appointmentId, patientId: input.patientId },
          select: { id: true },
        })
        if (!appt) throw new ValidationError("appointmentMismatch")
      }
      const row = await tx.consultationNote.create({
        data: {
          patientId: input.patientId,
          authorId: input.authorId,
          appointmentId: input.appointmentId,
          content: encryptField(input.content),
          category: input.category,
        },
        select: { id: true, createdAt: true },
      })
      await auditService.logWithTx(tx, {
        userId: input.authorId, action: "CREATE", resource: "CONSULTATION_NOTE",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: input.patientId, hasAppointment: !!input.appointmentId },
      })
      return row
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
// US-2072 — Teleconsultation billing (H3 guard against double-invoicing)
// ─────────────────────────────────────────────────────────────

const BILLING_CODE_RE = /^[A-Z0-9]{2,20}$/

export type TeleconsultActeDTO = {
  id: number
  appointmentId: number
  billingCode: string
  amountCents: number | null
  invoicedAt: Date | null
}
function toTeleconsultDTO(t: {
  id: number; appointmentId: number; billingCode: string;
  amountCents: number | null; invoicedAt: Date | null;
}): TeleconsultActeDTO {
  return {
    id: t.id, appointmentId: t.appointmentId, billingCode: t.billingCode,
    amountCents: t.amountCents, invoicedAt: t.invoicedAt,
  }
}

export const teleconsultActeService = {
  /** Helper for routes — fetch the patient owning the appointment. */
  async getAppointmentPatientId(appointmentId: number): Promise<number | null> {
    const a = await prisma.appointment.findUnique({
      where: { id: appointmentId }, select: { patientId: true },
    })
    return a?.patientId ?? null
  },

  async create(
    input: { appointmentId: number; billingCode: string; amountCents?: number },
    auditUserId: number, ctx?: AuditContext,
  ): Promise<TeleconsultActeDTO> {
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
        select: {
          id: true, appointmentId: true, billingCode: true,
          amountCents: true, invoicedAt: true,
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
      return toTeleconsultDTO(row)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async markInvoiced(id: number, auditUserId: number, ctx?: AuditContext): Promise<TeleconsultActeDTO> {
    return prisma.$transaction(async (tx) => {
      const acte = await tx.teleconsultationActe.findUnique({
        where: { id }, include: { appointment: { select: { patientId: true } } },
      })
      if (!acte) throw new NotFoundError()
      // H3 — refuse double-invoicing.
      if (acte.invoicedAt) throw new ValidationError("alreadyInvoiced")

      const updated = await tx.teleconsultationActe.update({
        where: { id },
        data: { invoicedAt: new Date(), invoicedBy: auditUserId },
        select: {
          id: true, appointmentId: true, billingCode: true,
          amountCents: true, invoicedAt: true,
        },
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
      return toTeleconsultDTO(updated)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2083 — Delegation requests (H5 payload schema, H8 cabinet, M11 self)
// ─────────────────────────────────────────────────────────────

export type DelegationDecision = Extract<DelegationRequestStatus, "approved" | "rejected">

const DELEGATION_PAYLOAD_MAX_BYTES = 2048
const DELEGATION_PAYLOAD_PII_RE = /\b(0[1-9])(\s*[\s.-]?\d{2}){4}\b|\d{7,}|@|\bnir\b|\bins\b/i

function validateDelegationPayload(payload: unknown): Prisma.InputJsonValue | undefined {
  if (payload === undefined || payload === null) return undefined
  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("payloadShape")
  }
  const serialized = JSON.stringify(payload)
  if (serialized.length > DELEGATION_PAYLOAD_MAX_BYTES) {
    throw new ValidationError("payloadSize")
  }
  // H5 — refuse free-form clinical PHI (digits, phone, email, NIR/INS mention).
  if (DELEGATION_PAYLOAD_PII_RE.test(serialized)) {
    throw new ValidationError("payloadLooksLikePii")
  }
  return payload as Prisma.InputJsonValue
}

export const delegationRequestService = {
  async create(
    input: {
      patientId: number; fromUserId: number; toUserId: number;
      action: string; payload?: unknown;
    },
    ctx?: AuditContext,
  ) {
    if (!input.action.trim() || input.action.length > 80) {
      throw new ValidationError("action")
    }
    const safePayload = validateDelegationPayload(input.payload)

    return prisma.$transaction(async (tx) => {
      await assertPatientAlive(input.patientId, tx)
      // H8 + M11 — caller and target must share a service with patient access.
      await assertColleagueWithPatientAccess(
        input.fromUserId, input.toUserId, input.patientId, tx,
      )
      const row = await tx.delegationRequest.create({
        data: {
          patientId: input.patientId,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          action: input.action.trim(),
          payload: safePayload ?? Prisma.JsonNull,
        },
        select: {
          id: true, patientId: true, fromUserId: true, toUserId: true,
          action: true, status: true, createdAt: true,
        },
      })
      await auditService.logWithTx(tx, {
        userId: input.fromUserId, action: "CREATE", resource: "DELEGATION_REQUEST",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: input.patientId, toUserId: input.toUserId, action: input.action },
      })
      return row // H12 — narrowed select (no payload returned)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async respond(
    id: number, reviewerId: number,
    decision: { status: DelegationDecision; reason?: string },
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
        select: {
          id: true, patientId: true, status: true, reviewedAt: true,
        },
      })
      await auditService.logWithTx(tx, {
        userId: reviewerId,
        // C5 — actions dédiées (plus de PROPOSAL_ACCEPTED/REJECTED ici).
        action: decision.status === "approved" ? "DELEGATION_APPROVED" : "DELEGATION_REJECTED",
        resource: "DELEGATION_REQUEST", resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: req.patientId, status: decision.status }, // pivot US-2268
      })
      return updated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async listInbox(toUserId: number, ctx?: AuditContext) {
    const items = await prisma.delegationRequest.findMany({
      where: { toUserId, status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, patientId: true, fromUserId: true,
        action: true, status: true, createdAt: true,
      },
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
// US-2084 — Member absences (M3, H7 — listForMember check)
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
      if (!member) throw new NotFoundError()
      if (member.serviceId === null) throw new ValidationError("memberHasNoService") // M3
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

  /**
   * H7 — caller must be a member of the absent member's service. Audit READ
   * row emitted with `metadata.memberId`.
   */
  async listForMember(memberId: number, auditUserId: number, ctx?: AuditContext) {
    const member = await prisma.healthcareMember.findUnique({
      where: { id: memberId }, select: { id: true, serviceId: true },
    })
    if (!member) throw new NotFoundError()
    if (member.serviceId === null) throw new ValidationError("memberHasNoService")
    await assertServiceMember(auditUserId, member.serviceId)

    const items = await prisma.memberAbsence.findMany({
      where: { memberId },
      orderBy: { startDate: "desc" },
      take: 50,
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "MEMBER_ABSENCE",
      resourceId: String(memberId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { memberId, serviceId: member.serviceId, count: items.length },
    })
    return items
  },
}

// ─────────────────────────────────────────────────────────────
// US-2086 — Handoff notes (H6 audit + consent, H8 colleague check)
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
      await assertColleagueWithPatientAccess(
        input.fromUserId, input.toUserId, input.patientId, tx,
      )
      const row = await tx.handoffNote.create({
        data: {
          patientId: input.patientId,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          note: encryptField(input.note),
        },
        select: { id: true, createdAt: true },
      })
      await auditService.logWithTx(tx, {
        userId: input.fromUserId, action: "CREATE", resource: "HANDOFF_NOTE",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: input.patientId, toUserId: input.toUserId },
      })
      return row
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
        select: { acknowledgedAt: true },
      })
      await auditService.logWithTx(tx, {
        userId, action: "UPDATE", resource: "HANDOFF_NOTE",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: h.patientId, kind: "ack" },
      })
      return updated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  /**
   * H6 — audit READ + filter to consenting patients (RGPD Art. 7.3).
   * `note` is decrypted on the way out. The filter goes via the privacy
   * settings of the patient's user.
   */
  async listInbox(toUserId: number, ctx?: AuditContext) {
    const items = await prisma.handoffNote.findMany({
      where: {
        toUserId, acknowledgedAt: null,
        patient: {
          deletedAt: null,
          user: { privacySettings: { gdprConsent: true, shareWithProviders: true } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    await auditService.log({
      userId: toUserId, action: "READ", resource: "HANDOFF_NOTE",
      resourceId: "inbox",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { toUserId, count: items.length },
    })
    return items.map((h) => ({ ...h, note: safeDecryptField(h.note) }))
  },
}

// ─────────────────────────────────────────────────────────────
// US-2088 — Patient groups (cohorts)
// ─────────────────────────────────────────────────────────────

const GROUP_LABEL_MAX = 80

export type PatientGroupDTO = { id: number; serviceId: number; label: string }
function toPatientGroupDTO(g: { id: number; serviceId: number; label: string }): PatientGroupDTO {
  return { id: g.id, serviceId: g.serviceId, label: g.label }
}

export const patientGroupService = {
  async listForService(serviceId: number, auditUserId: number, ctx?: AuditContext): Promise<PatientGroupDTO[]> {
    await assertServiceMember(auditUserId, serviceId)
    const items = await prisma.patientGroup.findMany({
      where: { serviceId }, orderBy: { label: "asc" },
      select: { id: true, serviceId: true, label: true },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT_GROUP",
      resourceId: String(serviceId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "list", serviceId, count: items.length },
    })
    return items.map(toPatientGroupDTO)
  },

  async create(
    input: { serviceId: number; label: string },
    auditUserId: number, ctx?: AuditContext,
  ): Promise<PatientGroupDTO> {
    const label = input.label.trim()
    if (!label || label.length > GROUP_LABEL_MAX) throw new ValidationError("label")
    return prisma.$transaction(async (tx) => {
      await assertServiceMember(auditUserId, input.serviceId, tx)
      const g = await tx.patientGroup.create({
        data: { serviceId: input.serviceId, label, createdBy: auditUserId },
        select: { id: true, serviceId: true, label: true },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "PATIENT_GROUP",
        resourceId: String(g.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { serviceId: input.serviceId },
      })
      return toPatientGroupDTO(g)
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
        // M4 — `skipDuplicates` retiré : on vient de tout supprimer, plus de
        // doublon possible. Simplifie le mock + clarifie l'intention.
        await tx.patientGroupAssignment.createMany({
          data: unique.map((groupId) => ({ patientId, groupId, assignedBy: auditUserId })),
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

  async listForPatient(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const assignments = await prisma.patientGroupAssignment.findMany({
      where: { patientId, patient: { deletedAt: null } },
      include: { group: { select: { id: true, serviceId: true, label: true } } },
      orderBy: { group: { label: "asc" } },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT_GROUP_ASSIGNMENT",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "list", count: assignments.length },
    })
    return assignments.map((a) => toPatientGroupDTO(a.group))
  },
}
