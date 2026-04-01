import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"
import type { DocumentCategory, Role, Prisma } from "@prisma/client"

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

const MAX_FILE_SIZE = 50 * 1024 * 1024

/** Serialize BigInt fields for JSON response */
function serializeDoc<T extends { fileSize: bigint | null }>(doc: T) {
  return { ...doc, fileSize: doc.fileSize !== null ? Number(doc.fileSize) : null }
}

export const documentService = {
  async list(patientId: number, role: Role, auditUserId: number, ctx?: AuditContext) {
    const where: Prisma.MedicalDocumentWhereInput = { patientId }
    if (role === "VIEWER") where.patientShare = true

    const docs = await prisma.medicalDocument.findMany({ where, orderBy: { createdAt: "desc" } })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "MEDICAL_DOCUMENT",
      resourceId: String(patientId), ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return docs.map(serializeDoc)
  },

  async create(
    patientId: number,
    input: { title: string; category?: DocumentCategory; patientShare?: boolean; mimeType: string; fileSize: number; memberId?: number },
    auditUserId: number, ctx?: AuditContext,
  ) {
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) throw new Error("invalidMimeType")
    if (input.fileSize > MAX_FILE_SIZE) throw new Error("fileTooLarge")

    return prisma.$transaction(async (tx) => {
      const doc = await tx.medicalDocument.create({
        data: {
          patientId, title: input.title, date: new Date(), category: input.category,
          patientShare: input.patientShare ?? true, mimeType: input.mimeType,
          fileSize: BigInt(input.fileSize), memberId: input.memberId, fileUrl: null,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "MEDICAL_DOCUMENT",
        resourceId: String(doc.id), ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return serializeDoc(doc)
    })
  },

  async delete(docId: number, patientId: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const doc = await tx.medicalDocument.findFirst({ where: { id: docId, patientId } })
      if (!doc) throw new Error("documentNotFound")

      await tx.medicalDocument.delete({ where: { id: docId } })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "MEDICAL_DOCUMENT",
        resourceId: String(docId), ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return { deleted: true }
    })
  },

  async markRead(docId: number, patientId: number, auditUserId: number) {
    const doc = await prisma.medicalDocument.findFirst({ where: { id: docId, patientId } })
    if (!doc) throw new Error("documentNotFound")

    await prisma.medicalDocument.update({ where: { id: docId }, data: { isRead: true } })

    await auditService.log({
      userId: auditUserId, action: "UPDATE", resource: "MEDICAL_DOCUMENT", resourceId: String(docId),
    })

    return { id: docId, isRead: true }
  },
}
