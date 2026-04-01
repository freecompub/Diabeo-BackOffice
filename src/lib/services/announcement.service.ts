import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

export const announcementService = {
  async list() {
    return prisma.announcement.findMany({
      where: { displayAnnouncement: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
  },

  async create(
    input: { title: string; content: string; callBackDelay?: number; displayShowButton?: boolean },
    auditUserId: number, ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.create({ data: input })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "USER",
        resourceId: `announcement:${announcement.id}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return announcement
    })
  },

  async update(
    id: number,
    input: { title?: string; content?: string; callBackDelay?: number; displayAnnouncement?: boolean; displayShowButton?: boolean },
    auditUserId: number, ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.update({ where: { id }, data: input })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "USER",
        resourceId: `announcement:${id}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return announcement
    })
  },

  async delete(id: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      await tx.announcement.delete({ where: { id } })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "USER",
        resourceId: `announcement:${id}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return { deleted: true }
    })
  },
}
