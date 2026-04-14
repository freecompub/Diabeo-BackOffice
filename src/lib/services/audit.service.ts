/**
 * @module audit.service
 * @description HDS audit logging service — immutable audit trail for medical data access.
 * All actions on sensitive data (PATIENT, CGM_ENTRY, INSULIN_THERAPY, etc.) are logged
 * with user, action, resource, IP, User-Agent, and optional metadata.
 * PostgreSQL trigger (audit_immutability.sql) prevents modification or deletion of logs.
 * @see CLAUDE.md#audit-traceability — Audit trail requirements
 * @see prisma/sql/audit_immutability.sql — Database trigger for immutability
 * @see Prisma schema — AuditLog model
 */

import { prisma } from "@/lib/db/client"
import { Prisma } from "@prisma/client"
import type { PrismaClient } from "@prisma/client"

/**
 * Prisma transaction client type — used by logWithTx for atomic writes.
 * @typedef {Object} TransactionClient
 */
type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]

/**
 * Audit action type — describes what was done.
 * @typedef {string} AuditAction
 * @enum {string}
 * @property {string} "LOGIN" - User login (session created)
 * @property {string} "LOGOUT" - User logout
 * @property {string} "READ" - Data read access (patient view, analytics fetch)
 * @property {string} "CREATE" - New record created
 * @property {string} "UPDATE" - Existing record modified
 * @property {string} "DELETE" - Record deleted (soft-delete)
 * @property {string} "EXPORT" - GDPR export generated
 * @property {string} "UNAUTHORIZED" - Failed access attempt
 * @property {string} "BOLUS_CALCULATED" - Bolus suggestion calculated
 * @property {string} "PROPOSAL_ACCEPTED" - Adjustment proposal approved
 * @property {string} "PROPOSAL_REJECTED" - Adjustment proposal declined
 */
export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "READ"
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "EXPORT"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "BOLUS_CALCULATED"
  | "PROPOSAL_ACCEPTED"
  | "PROPOSAL_REJECTED"
  | "IMPORT"

/**
 * Audit resource type — describes what was acted upon.
 * @typedef {string} AuditResource
 * @enum {string}
 */
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
  | "MYDIABBY_CREDENTIAL"
  | "MEDICATION"
  | "PUMP_EVENT"

/**
 * Audit log entry — parameters for logging an action.
 * Immutable once inserted (protected by DB trigger).
 * @typedef {Object} AuditLogEntry
 * @property {number} userId - User performing the action
 * @property {AuditAction} action - What was done
 * @property {AuditResource} resource - What was affected
 * @property {string} [resourceId] - Specific record ID (patient ID, entry ID, etc.)
 * @property {*} [oldValue] - Previous value (optional, for UPDATE logs)
 * @property {*} [newValue] - New value (optional, for UPDATE logs)
 * @property {string} [ipAddress] - Client IP from request headers
 * @property {string} [userAgent] - User-Agent from request headers
 * @property {Object} [metadata] - Additional context (event count, warnings, etc.)
 */
export interface AuditLogEntry {
  userId: number
  action: AuditAction
  resource: AuditResource
  resourceId?: string
  oldValue?: Prisma.InputJsonValue
  newValue?: Prisma.InputJsonValue
  ipAddress?: string
  userAgent?: string
  metadata?: Prisma.InputJsonValue
}

/**
 * Transform AuditLogEntry to Prisma create input — fills defaults (null/JsonNull).
 * @private
 * @param {AuditLogEntry} entry - Audit entry parameters
 * @returns {Prisma.AuditLogUncheckedCreateInput} Prisma-ready input object
 */
function createAuditData(entry: AuditLogEntry): Prisma.AuditLogUncheckedCreateInput {
  return {
    userId: entry.userId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    oldValue: entry.oldValue ?? Prisma.JsonNull,
    newValue: entry.newValue ?? Prisma.JsonNull,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    metadata: entry.metadata ?? {},
  }
}

/**
 * Extract IP and User-Agent from HTTP request headers.
 * Checks x-forwarded-for (proxy), x-real-ip fallback, defaults to "unknown".
 * @export
 * @param {Request} req - Fetch API Request object
 * @returns {{ipAddress: string, userAgent: string}} Extracted headers
 * @example
 * const ctx = extractRequestContext(req)
 * await auditService.log({ ..., ipAddress: ctx.ipAddress, userAgent: ctx.userAgent })
 */
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

/** Maximum query limit for audit log pagination */
const MAX_QUERY_LIMIT = 500

/**
 * Audit service — immutable logging for HDS compliance.
 * @namespace auditService
 */
export const auditService = {
  /**
   * Log an audit entry (standalone write outside transaction).
   * Use logWithTx if inside a transaction for atomicity.
   * @async
   * @param {AuditLogEntry} entry - Entry to log
   * @returns {Promise<Object>} Created AuditLog record
   * @see auditService.logWithTx — For transactional writes
   */
  async log(entry: AuditLogEntry) {
    return prisma.auditLog.create({
      data: createAuditData(entry),
    })
  },

  /**
   * Log within an existing Prisma transaction — ensures atomicity.
   * Used by services that log multiple operations (bolus + audit, patient create + audit, etc.).
   * @async
   * @param {TransactionClient} tx - Prisma transaction client (from $transaction callback)
   * @param {AuditLogEntry} entry - Entry to log within transaction
   * @returns {Promise<Object>} Created AuditLog record
   * @example
   * await prisma.$transaction(async (tx) => {
   *   const patient = await tx.patient.create({ data: { ... } })
   *   await auditService.logWithTx(tx, {
   *     userId: auditUserId,
   *     action: 'CREATE',
   *     resource: 'PATIENT',
   *     resourceId: String(patient.id)
   *   })
   * })
   */
  async logWithTx(tx: TransactionClient, entry: AuditLogEntry) {
    return tx.auditLog.create({
      data: createAuditData(entry),
    })
  },

  /**
   * Get audit logs for a specific resource (patient, entry, etc.).
   * Useful for compliance review of actions on one record.
   * @async
   * @param {AuditResource} resource - Resource type to query
   * @param {string} resourceId - Specific resource ID (patient ID, entry ID, etc.)
   * @param {number} [limit=50] - Max results (capped at MAX_QUERY_LIMIT)
   * @returns {Promise<Array<Object>>} Audit logs, newest first
   */
  async getByResource(resource: AuditResource, resourceId: string, limit = 50) {
    return prisma.auditLog.findMany({
      where: { resource, resourceId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, MAX_QUERY_LIMIT),
    })
  },

  /**
   * Get audit logs for a specific user (all actions they performed).
   * @async
   * @param {number} userId - User ID to query
   * @param {number} [limit=50] - Max results (capped at MAX_QUERY_LIMIT)
   * @returns {Promise<Array<Object>>} Audit logs, newest first
   */
  async getByUser(userId: number, limit = 50) {
    return prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, MAX_QUERY_LIMIT),
    })
  },

  /**
   * Advanced query with pagination and multiple filters — admin audit endpoint.
   * Called by GET /api/admin/audit-logs with Zod-validated filters.
   * @async
   * @param {Object} filters - Query filters (all optional)
   * @param {number} [filters.userId] - Filter by actor user ID
   * @param {string} [filters.resource] - Filter by resource type (PATIENT, CGM_ENTRY, etc.)
   * @param {string} [filters.action] - Filter by action type (READ, CREATE, UPDATE, etc.)
   * @param {Date} [filters.from] - Start date (inclusive)
   * @param {Date} [filters.to] - End date (inclusive)
   * @param {number} [filters.page=1] - Page number (1-indexed)
   * @param {number} [filters.limit=50] - Results per page (capped at 200)
   * @returns {Promise<{data: Array<Object>, pagination: Object}>} Logs with pagination info
   * @example
   * const result = await auditService.query({
   *   resource: 'PATIENT',
   *   from: new Date('2024-01-01'),
   *   to: new Date('2024-12-31'),
   *   page: 1,
   *   limit: 50
   * })
   */
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

    const where: Prisma.AuditLogWhereInput = {}
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
        include: {
          user: {
            select: { id: true, role: true },
          },
        },
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
