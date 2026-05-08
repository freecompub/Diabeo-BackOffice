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
  | "CONFIG_ERROR"
  | "MFA_SETUP_INITIATED"
  | "MFA_ENABLED"
  | "MFA_DISABLED"
  | "MFA_CHALLENGE_FAILED"
  | "BOLUS_CALCULATED"
  | "PROPOSAL_ACCEPTED"
  | "PROPOSAL_REJECTED"
  | "IMPORT"
  | "ANONYMIZE"
  /** US-2265 — RBAC-breach burst signal (50+ UNAUTHORIZED in 60s by same userId). */
  | "RBAC_BREACH_BURST"
  /**
   * US-2266 — Email accepté par le provider transactionnel (Resend).
   * **Sémantique HDS** : "submitted to MTA", PAS "delivered to recipient".
   * Une livraison réelle se trace via webhook provider en V1+ (EMAIL_DELIVERED
   * / EMAIL_BOUNCED). Le naming explicite "submitted" prévient toute lecture
   * forensique faussée ("le médecin a-t-il reçu l'alerte ?" → réponse honnête).
   */
  | "EMAIL_SUBMITTED"

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
  | "PUSH_NOTIFICATION"
  | "PUSH_REGISTRATION"
  | "AUDIT_LOG"
  /** US-2265 — emergency alerts / Mirror MVP resources. */
  | "EMERGENCY_ALERT"
  | "ALERT_THRESHOLD_CONFIG"
  | "KETONE_THRESHOLD"
  | "HYPO_TREATMENT_PROTOCOL"
  | "PREGNANCY_MODE"

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
  /** Correlation ID (HDS §IV.3) to join this audit row with stderr log lines. */
  requestId?: string
  metadata?: Prisma.InputJsonValue
}

/**
 * Input shape for {@link auditService.accessDenied}. The action is fixed to
 * `UNAUTHORIZED` internally — callers cannot override it. Exported as a named
 * type so route-helpers and tests share a single, stable contract.
 */
export type AccessDeniedInput = Omit<AuditLogEntry, "action">

/**
 * Request context extracted from the HTTP layer. Same shape as the return
 * value of {@link extractRequestContext}; defined here so audit-related
 * helpers don't need to import it from `patient.service.ts`.
 */
export interface AuditContext {
  ipAddress: string
  userAgent: string
  requestId: string
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
    requestId: entry.requestId ?? null,
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
  requestId: string
} {
  const headers = req.headers
  const ipAddress =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  const userAgent = headers.get("user-agent") ?? "unknown"
  // Correlation ID assigned by middleware. Falls back to "no-request-id" if
  // the route is invoked outside middleware scope (tests, server actions).
  const requestId = headers.get("x-request-id") ?? "no-request-id"
  return { ipAddress, userAgent, requestId }
}

/** Maximum query limit for audit log pagination */
const MAX_QUERY_LIMIT = 500

/** US-2265 — RBAC breach burst detection (in-memory, best-effort).
 *
 *  When a single userId triggers >= BURST_THRESHOLD UNAUTHORIZED events
 *  within BURST_WINDOW_MS, a single RBAC_BREACH_BURST event is emitted
 *  per cooldown window — so the SOC sees the spike without log flood.
 *
 *  ⚠️ Edge runtimes warning: this Map relies on shared process memory.
 *  Do not import this service from edge routes (Vercel Edge / Cloudflare
 *  Workers) where each request runs in an isolated V8 sandbox; counters
 *  would always be empty. The project deploys on OVH Docker (Node runtime),
 *  so this is fine today.
 */
const BURST_WINDOW_MS = 60_000
const BURST_THRESHOLD = 50
const BURST_COOLDOWN_MS = 60_000
const BURST_MAP_HARD_CAP = 10_000

interface BurstEntry {
  /** Sliding-window timestamps of recent UNAUTHORIZED events. */
  timestamps: number[]
  /** When the last RBAC_BREACH_BURST event was emitted (ms epoch). */
  lastBurstAt: number | null
  /** Last activity time — used as LRU pivot when evicting under cap pressure. */
  lastSeenAt: number
}
const burstMap = new Map<number, BurstEntry>()

/**
 * Bound memory under attack: when over the hard cap, evict the
 * least-recently-active entries (LRU on `lastSeenAt`). Combined with the
 * sliding-window cleanup that runs naturally on each call, this keeps the
 * Map bounded even when an attacker rotates through many compromised
 * accounts that each remain "warm".
 */
function evictLruIfOverCap(): void {
  if (burstMap.size <= BURST_MAP_HARD_CAP) return
  const sorted = Array.from(burstMap.entries()).sort(
    (a, b) => a[1].lastSeenAt - b[1].lastSeenAt,
  )
  const evictCount = burstMap.size - BURST_MAP_HARD_CAP
  for (let i = 0; i < evictCount; i++) {
    burstMap.delete(sorted[i]![0])
  }
}

/**
 * Record an UNAUTHORIZED event for a user; return the count of in-window
 * events if a fresh burst threshold was just crossed (caller emits a
 * RBAC_BREACH_BURST audit row), otherwise null.
 *
 * Cooldown semantics: once a burst row was emitted, repeat calls return
 * null until BURST_COOLDOWN_MS has elapsed.
 *
 * Best-effort, in-memory: a process restart loses the counter; OK because
 * the underlying UNAUTHORIZED events are already persisted in audit_logs
 * (the burst event is just an aggregated SOC signal).
 *
 * **The caller must commit `lastBurstAt = now` only after the burst audit
 * row was successfully persisted** — see {@link auditService.accessDenied}
 * for the atomicity contract.
 */
function recordAndCheckBurst(userId: number, now: number): number | null {
  const entry = burstMap.get(userId) ?? {
    timestamps: [],
    lastBurstAt: null,
    lastSeenAt: now,
  }
  // Slide the window: keep only timestamps within BURST_WINDOW_MS.
  entry.timestamps = entry.timestamps.filter((t) => now - t < BURST_WINDOW_MS)
  entry.timestamps.push(now)
  entry.lastSeenAt = now

  const inCooldown =
    entry.lastBurstAt !== null && now - entry.lastBurstAt < BURST_COOLDOWN_MS
  const crossed = entry.timestamps.length >= BURST_THRESHOLD && !inCooldown

  burstMap.set(userId, entry)
  evictLruIfOverCap()
  return crossed ? entry.timestamps.length : null
}

/** Mark a successful burst-row insert — only call after Prisma persistence. */
function markBurstEmitted(userId: number, now: number): void {
  const entry = burstMap.get(userId)
  if (entry) entry.lastBurstAt = now
}

/** Test-only — clears the burst-detection state. */
export function __resetAuditBurstState(): void {
  burstMap.clear()
}

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

  /**
   * US-2265 — Log a forbidden-access event (UNAUTHORIZED) with optional
   * burst-detection signal.
   *
   * Use this in routes whenever an *authenticated* user fails a RBAC check
   * (e.g. `canAccessPatient` returns false on a real existing resource).
   * Do NOT call it for unknown/non-existent resources — that would create
   * an existence oracle.
   *
   * When the same userId crosses {@link BURST_THRESHOLD} UNAUTHORIZED
   * events within a {@link BURST_WINDOW_MS} sliding window, a single
   * `RBAC_BREACH_BURST` event is emitted in addition (cooldown-rate-limited
   * to avoid log flooding while still raising a clear SOC alert).
   *
   * @returns Created UNAUTHORIZED audit row, plus optional burst row.
   */
  async accessDenied(
    entry: AccessDeniedInput,
  ): Promise<AccessDeniedResult> {
    const now = Date.now()
    const eventsInWindow = recordAndCheckBurst(entry.userId, now)

    if (eventsInWindow === null) {
      // Common case: no burst threshold crossed — single UNAUTHORIZED row.
      const unauthorizedRow = await prisma.auditLog.create({
        data: createAuditData({ ...entry, action: "UNAUTHORIZED" }),
      })
      return { unauthorizedRow, burstRow: null }
    }

    // Burst threshold crossed: emit both rows atomically. Cooldown is only
    // committed after a successful insert — if the transaction fails, the
    // next call will try the burst again rather than silently entering
    // cooldown on a row that never landed in the audit log.
    //
    // Prisma's $transaction([...]) array form returns AuditLog[] (homogeneous).
    // We cast to a tuple to preserve the asymmetric AccessDeniedResult shape
    // (`burstRow` may be null on the non-burst branch above).
    const txRows = (await prisma.$transaction([
      prisma.auditLog.create({
        data: createAuditData({ ...entry, action: "UNAUTHORIZED" }),
      }),
      prisma.auditLog.create({
        data: createAuditData({
          userId: entry.userId,
          action: "RBAC_BREACH_BURST",
          resource: entry.resource,
          resourceId: entry.resourceId,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          requestId: entry.requestId,
          metadata: {
            windowMs: BURST_WINDOW_MS,
            threshold: BURST_THRESHOLD,
            eventsInWindow,
          },
        }),
      }),
    ])) as [AuditLogRow, AuditLogRow]
    markBurstEmitted(entry.userId, now)
    return { unauthorizedRow: txRows[0], burstRow: txRows[1] }
  },
}

type AuditLogRow = Prisma.AuditLogGetPayload<Record<string, never>>
export interface AccessDeniedResult {
  unauthorizedRow: AuditLogRow
  burstRow: AuditLogRow | null
}
