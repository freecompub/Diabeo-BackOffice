import { prisma } from "@/lib/db/client"
import type { PrismaClient } from "@prisma/client"

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]
type AuditAction = "CREATE" | "READ" | "UPDATE" | "DELETE"
type AuditResource = "PATIENT" | "INSULIN_CONFIG" | "USER"

interface AuditLogEntry {
  userId: string
  action: AuditAction
  resource: AuditResource
  resourceId: string
  metadata?: Record<string, string>
}

function createAuditData(entry: AuditLogEntry) {
  return {
    userId: entry.userId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId,
    metadata: entry.metadata ?? {},
  }
}

export const auditService = {
  async log(entry: AuditLogEntry) {
    return prisma.auditLog.create({
      data: createAuditData(entry),
    })
  },

  /** Log within an existing transaction — ensures atomicity */
  async logWithTx(tx: TransactionClient, entry: AuditLogEntry) {
    return tx.auditLog.create({
      data: createAuditData(entry),
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
