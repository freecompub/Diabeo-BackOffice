import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import {
  mean, glToMgdl, glucoseManagementIndicator, coefficientOfVariation,
  computeTir, assessTirQuality, computeAgp, detectHypoEpisodes,
  cgmCaptureRate,
  type CgmThresholds, type TirResult, type TirQuality,
} from "@/lib/statistics"
import type { AuditContext } from "./patient.service"

const MIN_CAPTURE_RATE = 70 // percent
const MAX_PERIOD_DAYS = 90

function parsePeriod(period: string): number {
  const match = period.match(/^(\d+)d$/)
  if (!match) throw new Error("Invalid period format, use Nd (e.g. 14d)")
  const days = parseInt(match[1], 10)
  if (days < 1 || days > MAX_PERIOD_DAYS) {
    throw new Error(`Period must be between 1 and ${MAX_PERIOD_DAYS} days`)
  }
  return days
}

async function getPatientCgmValues(patientId: number, days: number) {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 3600_000)

  const entries = await prisma.cgmEntry.findMany({
    where: {
      patientId,
      timestamp: { gte: from, lte: to },
      valueGl: { gte: 0.40, lte: 5.00 },
    },
    orderBy: { timestamp: "asc" },
    select: { valueGl: true, timestamp: true },
  })

  const values = entries.map((e) => Number(e.valueGl))
  const withTimestamp = entries.map((e) => ({
    valueGl: Number(e.valueGl),
    timestamp: e.timestamp,
  }))

  return { values, withTimestamp, from, to, entryCount: entries.length, days }
}

async function getPatientThresholds(patientId: number): Promise<CgmThresholds> {
  const cgm = await prisma.cgmObjective.findUnique({ where: { patientId } })
  return {
    veryLow: cgm ? Number(cgm.veryLow) : 0.54,
    low: cgm ? Number(cgm.low) : 0.70,
    ok: cgm ? Number(cgm.ok) : 1.80,
    high: cgm ? Number(cgm.high) : 2.50,
  }
}

export const analyticsService = {
  async glycemicProfile(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const days = parsePeriod(period)
    const { values, from, to, entryCount } = await getPatientCgmValues(patientId, days)
    const thresholds = await getPatientThresholds(patientId)

    const captureRate = cgmCaptureRate(entryCount, days)
    const avgGl = mean(values)
    const avgMgdl = glToMgdl(avgGl)
    const cv = coefficientOfVariation(values)
    const tir = computeTir(values, thresholds)
    const quality = assessTirQuality(tir, cv)
    const gmi = glucoseManagementIndicator(avgMgdl)

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "CGM_ENTRY",
      resourceId: `${patientId}:analytics:profile`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return {
      period: { from: from.toISOString(), to: to.toISOString(), days },
      captureRate: Math.round(captureRate * 10) / 10,
      warning: captureRate < MIN_CAPTURE_RATE ? "insufficientCgmCapture" : undefined,
      metrics: {
        averageGlucoseGl: Math.round(avgGl * 100) / 100,
        averageGlucoseMgdl: Math.round(avgMgdl),
        gmi: Math.round(gmi * 10) / 10,
        coefficientOfVariation: Math.round(cv * 10) / 10,
        quality,
      },
      tir,
      readingCount: entryCount,
    }
  },

  async timeInRange(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const days = parsePeriod(period)
    const { values, entryCount } = await getPatientCgmValues(patientId, days)
    const thresholds = await getPatientThresholds(patientId)

    const tir = computeTir(values, thresholds)
    const cv = coefficientOfVariation(values)
    const quality = assessTirQuality(tir, cv)

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "CGM_ENTRY",
      resourceId: `${patientId}:analytics:tir`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return {
      tir,
      quality,
      thresholds,
      readingCount: entryCount,
      captureRate: Math.round(cgmCaptureRate(entryCount, days) * 10) / 10,
    }
  },

  async agp(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const days = parsePeriod(period)
    const { withTimestamp } = await getPatientCgmValues(patientId, days)

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "CGM_ENTRY",
      resourceId: `${patientId}:analytics:agp`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return computeAgp(withTimestamp)
  },

  async hypoglycemia(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const days = parsePeriod(period)
    const { withTimestamp } = await getPatientCgmValues(patientId, days)
    const thresholds = await getPatientThresholds(patientId)

    const episodes = detectHypoEpisodes(withTimestamp, {
      low: thresholds.low,
      veryLow: thresholds.veryLow,
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "CGM_ENTRY",
      resourceId: `${patientId}:analytics:hypo`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return {
      episodeCount: episodes.length,
      episodes,
      level1Count: episodes.filter((e) => e.severity === "level1").length,
      level2Count: episodes.filter((e) => e.severity === "level2").length,
    }
  },

  async insulinSummary(
    patientId: number,
    from: Date,
    to: Date,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const [flow, pumpEvents] = await Promise.all([
      prisma.insulinFlowEntry.findMany({
        where: { patientId, date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
      }),
      prisma.pumpEvent.findMany({
        where: { patientId, timestamp: { gte: from, lte: to } },
        orderBy: { timestamp: "asc" },
      }),
    ])

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "INSULIN_THERAPY",
      resourceId: `${patientId}:analytics:insulin`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    const totalUnits = flow.reduce((sum, f) => sum + (f.flow ? Number(f.flow) : 0), 0)
    const avgDaily = flow.length > 0 ? totalUnits / flow.length : 0

    return {
      totalUnits: Math.round(totalUnits * 100) / 100,
      avgDailyUnits: Math.round(avgDaily * 100) / 100,
      dayCount: flow.length,
      flow,
      pumpEvents,
    }
  },
}
