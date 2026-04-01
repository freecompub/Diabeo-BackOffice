import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

export const announcementService = {
  /** List active announcements */
  async list() {
    return prisma.announcement.findMany({
      where: { displayAnnouncement: true },
      orderBy: { createdAt: "desc" },
    })
  },

  /** Create an announcement (ADMIN only) */
  async create(
    input: { title: string; content: string; callBackDelay?: number; displayShowButton?: boolean },
    auditUserId: number, ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.create({ data: input })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "SESSION",
        resourceId: `announcement:${announcement.id}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return announcement
    })
  },

  /** Update an announcement (ADMIN only) */
  async update(
    id: number,
    input: { title?: string; content?: string; callBackDelay?: number; displayAnnouncement?: boolean; displayShowButton?: boolean },
    auditUserId: number,
  ) {
    return prisma.announcement.update({ where: { id }, data: input })
  },

  /** Delete an announcement (ADMIN only) */
  async delete(id: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      await tx.announcement.delete({ where: { id } })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "SESSION",
        resourceId: `announcement:${id}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return { deleted: true }
    })
  },
}
