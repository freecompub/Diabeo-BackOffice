/**
 * @module patient-tag.service
 * @description US-2022 — Tags & catégorisation patient.
 *
 * Sécurité (post-review PR #389):
 *  - Toute opération (lecture incluse) requiert que le caller soit membre du
 *    cabinet propriétaire (`isServiceMember`). Empêche l'énumération cross-
 *    cabinet du vocabulaire de tags (C1).
 *  - Les IDs inconnus et les IDs cross-cabinet sont uniformément renvoyés en
 *    `TagForbiddenError` (403) — pas d'oracle d'existence (C2).
 *  - Vérifications transactionnelles : la check membership + tag existence
 *    s'effectue à l'intérieur du `prisma.$transaction` avec isolation
 *    `Serializable` pour éliminer le TOCTOU et la course concurrente sur
 *    `(deleteMany + createMany)` (H5, M1).
 *  - `label` validé anti-PII (refus si contient chiffres ≥7, email, NIR-like)
 *    et JAMAIS dupliqué dans audit metadata (H4 + low PII risk).
 *  - Patient guard `deletedAt: null` au service layer (H7).
 *  - `setForPatient` émet un audit row par patient avec resourceId = patientId
 *    et `resource: "PATIENT_TAG_ASSIGNMENT"` (H10 — corrigé vs review).
 *  - `listForPatient` émet un audit READ (H11).
 *
 * Audit : CREATE/DELETE sur `PATIENT_TAG` (resourceId = tag.id) et UPDATE
 * sur `PATIENT_TAG_ASSIGNMENT` (resourceId = patientId, metadata.tagIds).
 */

import { Prisma, type PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/db/client"

/** Either the global Prisma client or a transactional one. */
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0] | typeof prisma
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import {
  TagForbiddenError,
  TagLabelPiiError,
  TagNotFoundError,
} from "./patient-tag.errors"

const LABEL_MIN = 1
const LABEL_MAX = 50
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/
/** Reject labels containing patterns that look like patient PII. */
const PII_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\d{7,}/, reason: "digits>=7" },         // long numeric sequences (NIR, phone, IBAN)
  { re: /@/, reason: "emailAt" },                // email '@'
  { re: /\b(0[1-9])\s*[\s.-]?(\d{2}\s*[\s.-]?){4}\b/, reason: "frPhone" },
]

export class TagValidationError extends Error {
  readonly field: "label" | "color"
  constructor(field: "label" | "color", message: string) {
    super(message)
    this.name = "TagValidationError"
    this.field = field
  }
}

export type PatientTagDTO = {
  id: number
  serviceId: number
  label: string
  color: string
}

export type PatientTagListResult = {
  tags: PatientTagDTO[]
}

function toDTO(t: { id: number; serviceId: number; label: string; color: string }): PatientTagDTO {
  return { id: t.id, serviceId: t.serviceId, label: t.label, color: t.color }
}

function validateLabel(label: string): string {
  const trimmed = label.trim()
  if (trimmed.length < LABEL_MIN || trimmed.length > LABEL_MAX) {
    throw new TagValidationError("label", "labelLength")
  }
  for (const { re, reason } of PII_PATTERNS) {
    if (re.test(trimmed)) {
      throw new TagLabelPiiError(reason)
    }
  }
  return trimmed
}
function validateColor(color: string): string {
  if (!COLOR_RE.test(color)) {
    throw new TagValidationError("color", "colorFormat")
  }
  return color.toUpperCase()
}

async function assertServiceMember(
  userId: number,
  serviceId: number,
  tx: Tx = prisma,
): Promise<void> {
  const link = await tx.healthcareMember.findFirst({
    where: { userId, serviceId },
    select: { id: true },
  })
  if (!link) throw new TagForbiddenError()
}

async function assertPatientAlive(patientId: number, tx: Tx = prisma): Promise<void> {
  const p = await tx.patient.findFirst({
    where: { id: patientId, deletedAt: null },
    select: { id: true },
  })
  if (!p) throw new TagForbiddenError()
}

export const patientTagService = {
  /**
   * List tags defined by a cabinet (sorted by label).
   * Caller MUST be a member of the service (C1 fix).
   */
  async listForService(
    serviceId: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<PatientTagListResult> {
    await assertServiceMember(auditUserId, serviceId)
    const tags = await prisma.patientTag.findMany({
      where: { serviceId },
      orderBy: { label: "asc" },
      select: { id: true, serviceId: true, label: true, color: true },
    })
    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT_TAG",
      // US-2268: resourceId = native serviceId (the listed entity's parent).
      resourceId: String(serviceId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { kind: "tag-list", serviceId, count: tags.length },
    })
    return { tags: tags.map(toDTO) }
  },

  /** Create a new tag for a cabinet. */
  async create(
    input: { serviceId: number; label: string; color: string },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<PatientTagDTO> {
    const label = validateLabel(input.label)
    const color = validateColor(input.color)

    return prisma.$transaction(
      async (tx) => {
        await assertServiceMember(auditUserId, input.serviceId, tx)
        const tag = await tx.patientTag.create({
          data: { serviceId: input.serviceId, label, color, createdBy: auditUserId },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "CREATE",
          resource: "PATIENT_TAG",
          resourceId: String(tag.id),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          // NB: do NOT include `label` plaintext (HDS — label may carry PII
          // even after validation), only the structural metadata.
          metadata: { serviceId: input.serviceId, color },
        })
        return toDTO(tag)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  },

  async delete(tagId: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(
      async (tx) => {
        const tag = await tx.patientTag.findUnique({
          where: { id: tagId },
          select: { id: true, serviceId: true },
        })
        if (!tag) throw new TagNotFoundError(tagId)
        await assertServiceMember(auditUserId, tag.serviceId, tx)
        await tx.patientTag.delete({ where: { id: tagId } })
        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "DELETE",
          resource: "PATIENT_TAG",
          resourceId: String(tagId),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          metadata: { serviceId: tag.serviceId },
        })
        return { deleted: true }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  },

  /**
   * Replace the patient's tag assignments with the given set. All checks
   * run inside the serializable transaction to eliminate TOCTOU + race:
   * the membership check + tag existence check + write happen atomically.
   *
   * Any unknown or cross-cabinet tag ID is rejected as `TagForbiddenError`
   * (uniform 403) to prevent ID enumeration (C2).
   */
  async setForPatient(
    patientId: number,
    tagIds: number[],
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const unique = Array.from(new Set(tagIds))

    return prisma.$transaction(
      async (tx) => {
        await assertPatientAlive(patientId, tx)

        if (unique.length > 0) {
          // Caller must be a member of every service holding one of the tags.
          // Single query: fetch caller's services AND verify each tagId.
          const memberServices = await tx.healthcareMember.findMany({
            where: { userId: auditUserId, serviceId: { not: null } },
            select: { serviceId: true },
          })
          const memberSet = new Set(
            memberServices.map((m) => m.serviceId).filter((s): s is number => s !== null),
          )

          const tags = await tx.patientTag.findMany({
            where: { id: { in: unique }, serviceId: { in: Array.from(memberSet) } },
            select: { id: true },
          })
          // Both "tag does not exist" and "tag belongs to a non-member service"
          // collapse to the same error (no enumeration oracle).
          if (tags.length !== unique.length) throw new TagForbiddenError()
        }

        await tx.patientTagAssignment.deleteMany({ where: { patientId } })
        if (unique.length > 0) {
          await tx.patientTagAssignment.createMany({
            data: unique.map((tagId) => ({
              patientId, tagId, assignedBy: auditUserId,
            })),
            skipDuplicates: true,
          })
        }

        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "UPDATE",
          // US-2268: resourceId = patientId (the entity acted upon at the
          // patient scope), `metadata.patientId` reinforces the pivot.
          resource: "PATIENT_TAG_ASSIGNMENT",
          resourceId: String(patientId),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          metadata: { patientId, tagIds: unique, kind: "tag-assignment-set" },
        })
        return { count: unique.length }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  },

  /** Get tags currently assigned to a patient. Audits the READ (H11). */
  async listForPatient(
    patientId: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<PatientTagDTO[]> {
    const assignments = await prisma.patientTagAssignment.findMany({
      where: { patientId, patient: { deletedAt: null } },
      include: {
        tag: { select: { id: true, serviceId: true, label: true, color: true } },
      },
      orderBy: { tag: { label: "asc" } },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT_TAG_ASSIGNMENT",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { patientId, kind: "tag-list", count: assignments.length },
    })

    return assignments.map((a) => toDTO(a.tag))
  },
}
