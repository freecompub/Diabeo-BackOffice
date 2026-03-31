import { prisma } from "@/lib/db/client"
import type { PrismaClient } from "@prisma/client"

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "READ"
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "EXPORT"
  | "UNAUTHORIZED"
  | "BOLUS_CALCULATED"
  | "PROPOSAL_ACCEPTED"
  | "PROPOSAL_REJECTED"

export type AuditResource =
  | "USER"
  | "PATIENT"
  | "CGM_ENTRY"
  | "GLYCEMIA_ENTRY"
  | "DIABETES_EVENT"
  | "INSULIN_THERAPY"
  | "BOLUS_LOG"
  | "ADJUSTMENT_PROPOSAL"
  | "MEDICAL_DOCUMENT"
  | "SESSION"

export interface AuditLogEntry {
  userId: number
  action: AuditAction
  resource: AuditResource
  resourceId?: string
  oldValue?: Record<string, unknown>
  newValue?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

function createAuditData(entry: AuditLogEntry) {
  return {
    userId: entry.userId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    oldValue: entry.oldValue ?? undefined,
    newValue: entry.newValue ?? undefined,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    metadata: entry.metadata ?? {},
  }
}

/** Extract IP and User-Agent from a Request object */
export function extractRequestContext(req: Request): {
  ipAddress: string
  userAgent: string
} {
  const headers = req.headers
  const ipAddress =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  const userAgent = headers.get("user-agent") ?? "unknown"
  return { ipAddress, userAgent }
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

  async getByUser(userId: number, limit = 50) {
    return prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    })
  },

  /** Query audit logs with filters — admin endpoint */
  async query(filters: {
    userId?: number
    resource?: string
    action?: string
    from?: Date
    to?: Date
    page?: number
    limit?: number
  }) {
    const page = filters.page ?? 1
    const limit = Math.min(filters.limit ?? 50, 200)
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (filters.userId) where.userId = filters.userId
    if (filters.resource) where.resource = filters.resource
    if (filters.action) where.action = filters.action
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from && { gte: filters.from }),
        ...(filters.to && { lte: filters.to }),
      }
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { user: { select: { id: true, email: true, firstname: true, lastname: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ])

    return {
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  },
}
