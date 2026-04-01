import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

const MAX_PERIOD_DAYS = 30
const CGM_MIN_GL = 0.40  // 40 mg/dL — no CGM reports below this
const CGM_MAX_GL = 5.00  // 500 mg/dL — max CGM sensor range

function enforceMaxPeriod(from: Date, to: Date) {
  if (to < from) throw new Error("'from' must be before 'to'")
  const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
  if (diffDays > MAX_PERIOD_DAYS) {
    throw new Error(`Period cannot exceed ${MAX_PERIOD_DAYS} days`)
  }
}

export const glycemiaService = {
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
}
