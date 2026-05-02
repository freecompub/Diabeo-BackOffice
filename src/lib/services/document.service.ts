import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { uploadFile, deleteFile, downloadFile, generateObjectKey } from "@/lib/storage/s3"
import { scanBuffer } from "./antivirus.service"
import { logger } from "@/lib/logger"
import type { AuditContext } from "./patient.service"
import type { DocumentCategory, Role, Prisma } from "@prisma/client"

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

const MAX_FILE_SIZE = 50 * 1024 * 1024

function serializeDoc<T extends { fileSize: bigint | null; fileUrl?: string | null }>(doc: T) {
  const { fileUrl: _omit, ...rest } = doc as T & { fileUrl?: string | null }
  return { ...rest, fileSize: doc.fileSize !== null ? Number(doc.fileSize) : null }
}

export const documentService = {
  async list(patientId: number, role: Role, auditUserId: number, ctx?: AuditContext) {
    const where: Prisma.MedicalDocumentWhereInput = {
      patientId,
      patient: { deletedAt: null },
    }
    if (role === "VIEWER") where.patientShare = true

    const docs = await prisma.medicalDocument.findMany({ where, orderBy: { createdAt: "desc" } })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "MEDICAL_DOCUMENT",
      resourceId: String(patientId), ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return docs.map(serializeDoc)
  },

  async upload(
    patientId: number,
    file: { buffer: Buffer; originalName: string; mimeType: string },
    meta: { title: string; category?: DocumentCategory; patientShare?: boolean; memberId?: number },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    if (!ALLOWED_MIME_TYPES.has(file.mimeType)) throw new Error("invalidMimeType")
    if (file.buffer.length === 0) throw new Error("emptyFile")
    if (file.buffer.length > MAX_FILE_SIZE) throw new Error("fileTooLarge")

    const scan = await scanBuffer(file.buffer, file.originalName)
    if (!scan.clean) throw new Error("virusDetected")

    const key = generateObjectKey("documents", file.mimeType)
    await uploadFile(key, file.buffer, file.mimeType)

    try {
      return await prisma.$transaction(async (tx) => {
        const doc = await tx.medicalDocument.create({
          data: {
            patientId,
            title: meta.title,
            date: new Date(),
            category: meta.category,
            patientShare: meta.patientShare ?? true,
            mimeType: file.mimeType,
            fileSize: BigInt(file.buffer.length),
            memberId: meta.memberId,
            fileUrl: key,
          },
        })

        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "CREATE",
          resource: "MEDICAL_DOCUMENT",
          resourceId: String(doc.id),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          metadata: { mimeType: file.mimeType, size: file.buffer.length, objectKey: key },
        })

        return serializeDoc(doc)
      })
    } catch (dbError) {
      await deleteFile(key).catch(() => {})
      throw dbError
    }
  },

  async create(
    patientId: number,
    input: { title: string; category?: DocumentCategory; patientShare?: boolean; mimeType: string; fileSize: number; memberId?: number },
    auditUserId: number, ctx?: AuditContext,
  ) {
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) throw new Error("invalidMimeType")
    if (input.fileSize === 0) throw new Error("emptyFile")
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

  async download(docId: number, patientId: number, role: Role, auditUserId: number, ctx?: AuditContext) {
    const doc = await prisma.medicalDocument.findFirst({
      where: { id: docId, patientId, patient: { deletedAt: null } },
    })
    if (!doc) throw new Error("documentNotFound")
    if (!doc.fileUrl) throw new Error("noFileAttached")
    if (role === "VIEWER" && !doc.patientShare) throw new Error("documentNotFound")

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "MEDICAL_DOCUMENT",
      resourceId: String(docId), ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      metadata: { operation: "download" },
    })

    const s3Result = await downloadFile(doc.fileUrl)
    return { ...s3Result, fileName: doc.title }
  },

  async delete(docId: number, patientId: number, auditUserId: number, ctx?: AuditContext) {
    const result = await prisma.$transaction(async (tx) => {
      const doc = await tx.medicalDocument.findFirst({
        where: { id: docId, patientId, patient: { deletedAt: null } },
      })
      if (!doc) throw new Error("documentNotFound")

      await tx.medicalDocument.delete({ where: { id: docId } })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "MEDICAL_DOCUMENT",
        resourceId: String(docId), ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return { fileUrl: doc.fileUrl }
    })

    if (result.fileUrl) {
      await deleteFile(result.fileUrl).catch((err) => {
        logger.error("document.delete", "S3 cleanup failed", {}, err)
      })
    }

    return { deleted: true }
  },

  async markRead(docId: number, patientId: number, auditUserId: number) {
    const doc = await prisma.medicalDocument.findFirst({
      where: { id: docId, patientId, patient: { deletedAt: null } },
    })
    if (!doc) throw new Error("documentNotFound")

    await prisma.medicalDocument.update({ where: { id: docId }, data: { isRead: true } })

    await auditService.log({
      userId: auditUserId, action: "UPDATE", resource: "MEDICAL_DOCUMENT", resourceId: String(docId),
    })

    return { id: docId, isRead: true }
  },
}
