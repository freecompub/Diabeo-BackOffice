import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

const MAX_PERIOD_DAYS = 30
const CGM_MIN_GL = 0.40  // 40 mg/dL — no CGM reports below this
const CGM_MAX_GL = 5.00  // 500 mg/dL — max CGM sensor range

export const glycemiaService = {
  /** Get CGM entries for a patient within a date range */
  async getCgmEntries(
    patientId: number,
    from: Date,
    to: Date,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    // Enforce max 30 days
    const diffMs = to.getTime() - from.getTime()
    const diffDays = diffMs / (1000 * 60 * 60 * 24)
    if (diffDays > MAX_PERIOD_DAYS) {
      throw new Error(`Period cannot exceed ${MAX_PERIOD_DAYS} days`)
    }

    const entries = await prisma.cgmEntry.findMany({
      where: {
        patientId,
        timestamp: { gte: from, lte: to },
        // Filter out-of-range values
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

  /** Get glycemia entries (manual readings) for a patient */
  async getGlycemiaEntries(
    patientId: number,
    from: Date,
    to: Date,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const entries = await prisma.glycemiaEntry.findMany({
      where: {
        patientId,
        date: { gte: from, lte: to },
      },
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

  /** Get average data (current, 7d, 30d) for a patient */
  async getAverageData(patientId: number) {
    const averages = await prisma.averageData.findMany({
      where: { patientId },
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

  /** Get insulin flow entries for a date range */
  async getInsulinFlow(patientId: number, from: Date, to: Date) {
    return prisma.insulinFlowEntry.findMany({
      where: { patientId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    })
  },

  /** Get insulin flow device data for a date range */
  async getInsulinFlowDeviceData(patientId: number, from: Date, to: Date) {
    return prisma.insulinFlowDeviceData.findMany({
      where: { patientId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    })
  },

  /** Get pump events for a date range */
  async getPumpEvents(patientId: number, from: Date, to: Date, eventType?: string) {
    return prisma.pumpEvent.findMany({
      where: {
        patientId,
        timestamp: { gte: from, lte: to },
        ...(eventType ? { eventType } : {}),
      },
      orderBy: { timestamp: "asc" },
    })
  },
}
