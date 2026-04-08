/**
 * @module glycemia.service
 * @description Glucose data access — CGM entries, glycemia readings, insulin flow, pump events.
 * All reads enforce 30-day max period for performance. CGM values validated (0.40-5.00 g/L).
 * All reads logged for HDS audit trail.
 * @see CLAUDE.md#glycemia — CGM data model
 * @see Prisma schema — CgmEntry, GlycemiaEntry, AverageData, InsulinFlowEntry, PumpEvent models
 */

import { prisma } from "@/lib/db/client"
import type { Prisma } from "@prisma/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

/** Max query period to prevent performance issues */
const MAX_PERIOD_DAYS = 30
/** CGM minimum range — below 40 mg/dL is sensor out-of-range */
const CGM_MIN_GL = 0.40  // 40 mg/dL
/** CGM maximum range — above 500 mg/dL is sensor out-of-range */
const CGM_MAX_GL = 5.00  // 500 mg/dL

/**
 * Enforce maximum query period — prevents large data loads.
 * @private
 * @param {Date} from - Start date
 * @param {Date} to - End date
 * @throws {Error} If period exceeds MAX_PERIOD_DAYS
 */
function enforceMaxPeriod(from: Date, to: Date) {
  if (to < from) throw new Error("'from' must be before 'to'")
  const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
  if (diffDays > MAX_PERIOD_DAYS) {
    throw new Error(`Period cannot exceed ${MAX_PERIOD_DAYS} days`)
  }
}

/**
 * Glucose data service — CGM, glycemia, insulin flows, pump events.
 * @namespace glycemiaService
 */
export const glycemiaService = {
  /**
   * Get CGM (continuous glucose monitoring) entries for a patient.
   * Filters invalid readings (out of sensor range: < 0.40 or > 5.00 g/L).
   * Enforces 30-day max period. Logs READ audit entry with IP/UA.
   * @async
   * @param {number} patientId - Patient ID
   * @param {Date} from - Start date (inclusive)
   * @param {Date} to - End date (inclusive)
   * @param {number} auditUserId - User ID performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Array<Object>>} CGM entries sorted by timestamp
   * @throws {Error} If period exceeds 30 days
   */
  async getCgmEntries(
    patientId: number, from: Date, to: Date,
    auditUserId: number, ctx?: AuditContext,
  ) {
    enforceMaxPeriod(from, to)

    const entries = await prisma.cgmEntry.findMany({
      where: {
        patientId,
        timestamp: { gte: from, lte: to },
        valueGl: { gte: CGM_MIN_GL, lte: CGM_MAX_GL },
      },
      orderBy: { timestamp: "asc" },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "CGM_ENTRY",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { from: from.toISOString(), to: to.toISOString(), count: entries.length },
    })

    return entries
  },

  /**
   * Get manual glycemia (point-of-care) readings for a patient.
   * @async
   * @param {number} patientId - Patient ID
   * @param {Date} from - Start date (inclusive)
   * @param {Date} to - End date (inclusive)
   * @param {number} auditUserId - User ID performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Array<Object>>} Glycemia entries sorted by date then time
   * @throws {Error} If period exceeds 30 days
   */
  async getGlycemiaEntries(
    patientId: number, from: Date, to: Date,
    auditUserId: number, ctx?: AuditContext,
  ) {
    enforceMaxPeriod(from, to)

    const entries = await prisma.glycemiaEntry.findMany({
      where: { patientId, date: { gte: from, lte: to } },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "GLYCEMIA_ENTRY",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { count: entries.length },
    })

    return entries
  },

  /**
   * Get pre-computed average glucose data (daily, 7-day, 30-day periods).
   * Returns grouped by periodType (current, 7d, 30d).
   * @async
   * @param {number} patientId - Patient ID
   * @param {number} auditUserId - User ID performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<{current: Array, avg7d: Array, avg30d: Array}>} Averages grouped by period
   */
  async getAverageData(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const averages = await prisma.averageData.findMany({
      where: { patientId },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "CGM_ENTRY",
      resourceId: `${patientId}:averages`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    const grouped: Record<string, typeof averages> = {}
    for (const avg of averages) {
      const key = avg.periodType
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(avg)
    }

    return {
      current: grouped["current"] ?? [],
      avg7d: grouped["7d"] ?? [],
      avg30d: grouped["30d"] ?? [],
    }
  },

  /**
   * Get insulin administration flow (daily insulin summary).
   * @async
   * @param {number} patientId - Patient ID
   * @param {Date} from - Start date (inclusive)
   * @param {Date} to - End date (inclusive)
   * @param {number} auditUserId - User ID performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Array<Object>>} Insulin flow entries sorted by date
   * @throws {Error} If period exceeds 30 days
   */
  async getInsulinFlow(
    patientId: number, from: Date, to: Date,
    auditUserId: number, ctx?: AuditContext,
  ) {
    enforceMaxPeriod(from, to)

    const entries = await prisma.insulinFlowEntry.findMany({
      where: { patientId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "INSULIN_THERAPY",
      resourceId: `${patientId}:insulinFlow`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return entries
  },

  /**
   * Get pump events (alarms, suspends, resets, etc.).
   * Optionally filtered by eventType.
   * @async
   * @param {number} patientId - Patient ID
   * @param {Date} from - Start date (inclusive)
   * @param {Date} to - End date (inclusive)
   * @param {number} auditUserId - User ID performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @param {string} [eventType] - Optional filter (e.g., "alarm", "suspend")
   * @returns {Promise<Array<Object>>} Pump events sorted by timestamp
   * @throws {Error} If period exceeds 30 days
   */
  async getPumpEvents(
    patientId: number, from: Date, to: Date,
    auditUserId: number, ctx?: AuditContext,
    eventType?: string,
  ) {
    enforceMaxPeriod(from, to)

    const entries = await prisma.pumpEvent.findMany({
      where: {
        patientId,
        timestamp: { gte: from, lte: to },
        ...(eventType ? { eventType } : {}),
      },
      orderBy: { timestamp: "asc" },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "INSULIN_THERAPY",
      resourceId: `${patientId}:pumpEvents`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return entries
  },

  /**
   * Create a new pump event (alarm, suspend, reset, bolus delivery, etc.).
   * @async
   * @param {number} patientId - Patient ID
   * @param {Object} input - Event data (timestamp, eventType, data)
   * @param {number} auditUserId - User performing create (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Object>} Created PumpEvent
   */
  async createPumpEvent(
    patientId: number,
    input: { timestamp: Date; eventType: string; data?: Prisma.InputJsonValue },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const event = await tx.pumpEvent.create({
        data: {
          patientId,
          timestamp: input.timestamp,
          eventType: input.eventType,
          data: input.data ?? undefined,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "PUMP_EVENT",
        resourceId: String(event.id),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { eventType: input.eventType },
      })

      return event
    })
  },

  /**
   * Delete a pump event by ID.
   * @async
   * @param {number} id - PumpEvent ID
   * @param {number} auditUserId - User performing delete (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<{deleted: true}>}
   */
  async deletePumpEvent(
    id: number,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.pumpEvent.delete({ where: { id } })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "PUMP_EVENT",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return { deleted: true }
    })
  },
}
