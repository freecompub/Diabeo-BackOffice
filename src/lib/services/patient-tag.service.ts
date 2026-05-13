/**
 * @module patient-tag.service
 * @description US-2022 — Tags & catégorisation patient.
 *
 * Chaque `HealthcareService` (cabinet) maintient son propre vocabulaire de
 * tags. Un tag est posé sur un patient via `PatientTagAssignment`. La
 * sémantique est libre — étiquettes type "à appeler", "VIP", "ALD",
 * "non observant", etc. Pas de PII clinique : couleur + label uniquement.
 *
 * RBAC:
 *  - Lister / créer / supprimer un tag du cabinet : DOCTOR+ membre du service.
 *  - Affecter / désaffecter un tag à un patient : NURSE+ avec accès patient.
 *
 * Audit : CREATE/DELETE sur `PATIENT_TAG` (resourceId = tag.id) et
 * `PATIENT_TAG_ASSIGNMENT` (resourceId = assignment.id, metadata.patientId).
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"

const LABEL_MIN = 1
const LABEL_MAX = 50
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/

export class TagValidationError extends Error {
  readonly field: "label" | "color"
  constructor(field: "label" | "color", message: string) {
    super(message)
    this.name = "TagValidationError"
    this.field = field
  }
}

function validateLabel(label: string): string {
  const trimmed = label.trim()
  if (trimmed.length < LABEL_MIN || trimmed.length > LABEL_MAX) {
    throw new TagValidationError("label", "labelLength")
  }
  return trimmed
}
function validateColor(color: string): string {
  if (!COLOR_RE.test(color)) {
    throw new TagValidationError("color", "colorFormat")
  }
  return color.toUpperCase()
}

async function isServiceMember(userId: number, serviceId: number): Promise<boolean> {
  const link = await prisma.healthcareMember.findFirst({
    where: { userId, serviceId },
    select: { id: true },
  })
  return !!link
}

export const patientTagService = {
  /** List tags defined by a cabinet (sorted by label). */
  async listForService(serviceId: number, auditUserId: number, ctx?: AuditContext) {
    const tags = await prisma.patientTag.findMany({
      where: { serviceId },
      orderBy: { label: "asc" },
    })
    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT_TAG",
      resourceId: `service:${serviceId}`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { kind: "tag-list", serviceId, count: tags.length },
    })
    return tags
  },

  /** Create a new tag for a cabinet. Caller must be member of the service. */
  async create(
    input: { serviceId: number; label: string; color: string },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    if (!(await isServiceMember(auditUserId, input.serviceId))) {
      throw new Error("forbidden")
    }
    const label = validateLabel(input.label)
    const color = validateColor(input.color)

    return prisma.$transaction(async (tx) => {
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
        metadata: { serviceId: input.serviceId, label, color },
      })
      return tag
    })
  },

  async delete(tagId: number, auditUserId: number, ctx?: AuditContext) {
    const tag = await prisma.patientTag.findUnique({
      where: { id: tagId },
      select: { id: true, serviceId: true, label: true },
    })
    if (!tag) throw new Error("tagNotFound")
    if (!(await isServiceMember(auditUserId, tag.serviceId))) {
      throw new Error("forbidden")
    }
    return prisma.$transaction(async (tx) => {
      await tx.patientTag.delete({ where: { id: tagId } })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "PATIENT_TAG",
        resourceId: String(tagId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: { serviceId: tag.serviceId, label: tag.label },
      })
      return { deleted: true }
    })
  },

  /** Replace the patient's tag assignments with the given set (atomic). */
  async setForPatient(
    patientId: number,
    tagIds: number[],
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    // Reject duplicates + ensure all tags exist in some service the caller
    // is a member of (prevents cross-cabinet contamination).
    const unique = Array.from(new Set(tagIds))
    if (unique.length > 0) {
      const tags = await prisma.patientTag.findMany({
        where: { id: { in: unique } },
        select: { id: true, serviceId: true },
      })
      if (tags.length !== unique.length) throw new Error("tagNotFound")
      const memberServices = await prisma.healthcareMember.findMany({
        where: { userId: auditUserId, serviceId: { in: tags.map((t) => t.serviceId) } },
        select: { serviceId: true },
      })
      const memberSet = new Set(memberServices.map((m) => m.serviceId))
      if (tags.some((t) => !memberSet.has(t.serviceId))) throw new Error("forbidden")
    }

    return prisma.$transaction(async (tx) => {
      await tx.patientTagAssignment.deleteMany({ where: { patientId } })
      if (unique.length > 0) {
        await tx.patientTagAssignment.createMany({
          data: unique.map((tagId) => ({ patientId, tagId, assignedBy: auditUserId })),
        })
      }
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT_TAG_ASSIGNMENT",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: { patientId, tagIds: unique },
      })
      return { count: unique.length }
    })
  },

  /** Get tags currently assigned to a patient. */
  async listForPatient(patientId: number) {
    const assignments = await prisma.patientTagAssignment.findMany({
      where: { patientId },
      include: { tag: true },
      orderBy: { tag: { label: "asc" } },
    })
    return assignments.map((a) => a.tag)
  },
}
