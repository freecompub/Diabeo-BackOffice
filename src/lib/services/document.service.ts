import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"
import type { DocumentCategory, Prisma } from "@prisma/client"

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg", "image/png", "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

export const documentService = {
  /** List documents accessible to the user */
  async list(
    patientId: number,
    role: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const where: Prisma.MedicalDocumentWhereInput = { patientId }

    // Patients can only see documents shared with them
    if (role === "VIEWER") {
      where.patientShare = true
    }

    const docs = await prisma.medicalDocument.findMany({
      where,
      orderBy: { createdAt: "desc" },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "MEDICAL_DOCUMENT",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return docs
  },

  /** Create a document entry (file upload to S3 is a TODO) */
  async create(
    patientId: number,
    input: {
      title: string
      category?: DocumentCategory
      patientShare?: boolean
      mimeType: string
      fileSize: number
      memberId?: number
    },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
      throw new Error("invalidMimeType")
    }
    if (input.fileSize > MAX_FILE_SIZE) {
      throw new Error("fileTooLarge")
    }

    return prisma.$transaction(async (tx) => {
      const doc = await tx.medicalDocument.create({
        data: {
          patientId,
          title: input.title,
          date: new Date(),
          category: input.category,
          patientShare: input.patientShare ?? true,
          mimeType: input.mimeType,
          fileSize: BigInt(input.fileSize),
          memberId: input.memberId,
          // TODO: Upload file to OVH S3 and set fileUrl
          fileUrl: null,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "MEDICAL_DOCUMENT",
        resourceId: String(doc.id),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return doc
    })
  },

  /** Delete a document */
  async delete(docId: number, patientId: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const doc = await tx.medicalDocument.findFirst({
        where: { id: docId, patientId },
      })
      if (!doc) throw new Error("documentNotFound")

      // TODO: Delete file from OVH S3
      await tx.medicalDocument.delete({ where: { id: docId } })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "MEDICAL_DOCUMENT",
        resourceId: String(docId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return { deleted: true }
    })
  },

  /** Mark document as read */
  async markRead(docId: number, auditUserId: number) {
    return prisma.medicalDocument.update({
      where: { id: docId },
      data: { isRead: true },
    })
  },
}
