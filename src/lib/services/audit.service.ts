import { prisma } from "@/lib/db/client"

type AuditAction = "CREATE" | "READ" | "UPDATE" | "DELETE"
type AuditResource = "PATIENT" | "INSULIN_CONFIG" | "USER"

interface AuditLogEntry {
  userId: string
  action: AuditAction
  resource: AuditResource
  resourceId: string
  metadata?: Record<string, string>
}

export const auditService = {
  async log(entry: AuditLogEntry) {
    return prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        metadata: entry.metadata ?? {},
      },
    })
  },

  async getByResource(resource: AuditResource, resourceId: string) {
    return prisma.auditLog.findMany({
      where: { resource, resourceId },
      orderBy: { createdAt: "desc" },
    })
  },

  async getByUser(userId: string, limit = 50) {
    return prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    })
  },
}
