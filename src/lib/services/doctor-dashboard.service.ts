/**
 * @module doctor-dashboard.service
 * @description Groupe 9b Batch 1 — Dashboard médecin (5 US, ~34 SP).
 *
 *  - US-2400 page principale (page conteneur)
 *  - US-2401 urgences en cours (polling 30s, max 5, criticité desc)
 *  - US-2402 RDV du jour (today's appointments, max 3)
 *  - US-2403 patients à suivre (computed on-demand, no nightly batch)
 *  - US-2404 KPI cabinet 14j (4 KPIs : actifs, TIR moyen, urgences sem, propositions)
 *
 * Tous les endpoints sont DOCTOR/NURSE-gated et scopés au portefeuille du
 * caller via `getAccessiblePatientIds` (RBAC). ADMIN = no restriction.
 *
 * Patients-à-suivre est calculé on-demand sur le portefeuille (hypos 7j,
 * silence saisie 5j, sans persister de table flag) — décision pragmatique
 * pour shipper le batch sans batch job nocturne. Ré-évaluable en V2 si
 * le coût compute devient un problème.
 */

import {
  EmergencyAlertStatus,
  EmergencyAlertType,
  EmergencyAlertSeverity,
  AppointmentStatus,
  type Prisma,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { getAccessiblePatientIds } from "@/lib/access-control"
import { auditService, type AuditContext } from "./audit.service"
import { safeDecryptField } from "@/lib/crypto/fields"
import type { Role } from "@prisma/client"

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Build the patient-portfolio `WHERE` clause for cross-patient queries.
 * Returns `{}` for ADMIN (no restriction) ; otherwise an `IN` filter.
 * Empty array → forces no rows (caller has empty portfolio).
 */
function patientScopeWhere(
  ids: number[] | null,
): { patientId?: { in: number[] } } | null {
  if (ids === null) return {} // ADMIN — no restriction
  if (ids.length === 0) return null // empty portfolio → no rows
  return { patientId: { in: ids } }
}

const CRITICALITY_ORDER: Record<EmergencyAlertType, number> = {
  ketone_dka: 0,
  severe_hypo: 1,
  ketone_moderate: 2,
  hypo: 3,
  severe_hyper: 4,
  hyper: 5,
  manual: 6,
}

// ─────────────────────────────────────────────────────────────
// US-2401 — Urgencies in progress
// ─────────────────────────────────────────────────────────────

export type UrgencyItem = {
  id: number
  patientId: number
  alertType: EmergencyAlertType
  severity: EmergencyAlertSeverity
  status: EmergencyAlertStatus
  triggeredAt: Date
  glucoseValueMgdl: number | null
  ketoneValueMmol: number | null
  /** First-name only (privacy on dashboard) — empty string if decryption fails. */
  patientFirstName: string
  pathology: string | null
}

const URGENCY_LIMIT = 5

export const urgenciesQuery = {
  async forCaller(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<UrgencyItem[]> {
    const ids = await getAccessiblePatientIds(userId, role)
    const scope = patientScopeWhere(ids)
    if (scope === null) return [] // empty portfolio
    const rows = await prisma.emergencyAlert.findMany({
      where: {
        ...scope,
        status: { in: [EmergencyAlertStatus.open, EmergencyAlertStatus.acknowledged] },
        patient: { deletedAt: null },
      },
      include: {
        patient: {
          select: {
            id: true, pathology: true,
            user: { select: { firstname: true } },
          },
        },
      },
      orderBy: [{ triggeredAt: "desc" }],
      // Over-fetch then sort by criticality in-memory (small N, K ≤ 5).
      take: 50,
    })
    const sorted = rows
      .sort((a, b) => {
        const cmp = CRITICALITY_ORDER[a.alertType] - CRITICALITY_ORDER[b.alertType]
        if (cmp !== 0) return cmp
        return b.triggeredAt.getTime() - a.triggeredAt.getTime()
      })
      .slice(0, URGENCY_LIMIT)

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "EMERGENCY_ALERT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.medecin.urgencies", count: sorted.length },
    })

    return sorted.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      alertType: r.alertType,
      severity: r.severity,
      status: r.status,
      triggeredAt: r.triggeredAt,
      glucoseValueMgdl: r.glucoseValueMgdl?.toNumber() ?? null,
      ketoneValueMmol: r.ketoneValueMmol?.toNumber() ?? null,
      patientFirstName: safeDecryptField(r.patient.user.firstname ?? "") ?? "",
      pathology: r.patient.pathology,
    }))
  },
}

// ─────────────────────────────────────────────────────────────
// US-2402 — Today's appointments
// ─────────────────────────────────────────────────────────────

export type AppointmentItem = {
  id: number
  patientId: number
  date: Date
  hour: Date | null
  type: string | null
  status: AppointmentStatus
  location: string | null
  patientFirstName: string
  pathology: string | null
}

const APPOINTMENTS_LIMIT = 3

function todayBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

export const appointmentsQuery = {
  async forCaller(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<AppointmentItem[]> {
    const ids = await getAccessiblePatientIds(userId, role)
    const scope = patientScopeWhere(ids)
    if (scope === null) return []
    const { start, end } = todayBounds()
    const where: Prisma.AppointmentWhereInput = {
      ...scope,
      date: { gte: start, lt: end },
      status: { in: [AppointmentStatus.scheduled, AppointmentStatus.pending_validation] },
      patient: { deletedAt: null },
    }
    const rows = await prisma.appointment.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true, pathology: true,
            user: { select: { firstname: true } },
          },
        },
      },
      orderBy: [{ hour: "asc" }],
      take: APPOINTMENTS_LIMIT,
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "APPOINTMENT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.medecin.appointments", count: rows.length },
    })

    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      date: r.date,
      hour: r.hour,
      type: r.type,
      status: r.status,
      location: r.location ?? null,
      patientFirstName: safeDecryptField(r.patient.user.firstname ?? "") ?? "",
      pathology: r.patient.pathology,
    }))
  },
}

// ─────────────────────────────────────────────────────────────
// US-2403 — Patients at risk (on-demand, no batch job)
// ─────────────────────────────────────────────────────────────

export type RiskReason = "recentHypos" | "silentMonitoring" | "tirDrop"

export type PatientAtRiskItem = {
  patientId: number
  patientFirstName: string
  pathology: string | null
  reason: RiskReason
  /** Free-form metric label (e.g. "4 hypos / 7j", "12 jours sans saisie"). */
  metricLabel: string
  /** Higher = more critical. Used for sort. */
  score: number
}

const RISK_LIMIT = 3
/** ≥ this hypos in window = flag. */
const HYPO_THRESHOLD_7D = 3
/** No CGM/manual entry in N days = silent. */
const SILENT_DAYS = 5

export const patientsAtRiskQuery = {
  /**
   * Compute risk flags on-demand for the caller's portfolio. NOT a nightly
   * batch — re-runs on every dashboard load. At small N (≤ 200 patients),
   * cost is acceptable ; revisit with cache (Redis TTL ~5min) at scale.
   *
   * Excludes patients that currently have an OPEN urgency (they're already
   * surfaced in the urgencies card).
   */
  async forCaller(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<PatientAtRiskItem[]> {
    const ids = await getAccessiblePatientIds(userId, role)
    if (ids !== null && ids.length === 0) return []
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
    const silentCutoff = new Date(now.getTime() - SILENT_DAYS * 86_400_000)

    // Patients with open urgencies (excluded from list).
    const inUrgencyRows = await prisma.emergencyAlert.findMany({
      where: {
        ...(ids ? { patientId: { in: ids } } : {}),
        status: { in: [EmergencyAlertStatus.open, EmergencyAlertStatus.acknowledged] },
      },
      select: { patientId: true },
      distinct: ["patientId"],
    })
    const exclude = new Set(inUrgencyRows.map((r) => r.patientId))

    // Hypo count last 7 days, by patient.
    const hypoCounts = await prisma.emergencyAlert.groupBy({
      by: ["patientId"],
      where: {
        ...(ids ? { patientId: { in: ids } } : {}),
        alertType: { in: [EmergencyAlertType.hypo, EmergencyAlertType.severe_hypo] },
        triggeredAt: { gte: sevenDaysAgo },
      },
      _count: { patientId: true },
    })

    // Silence detection : latest cgmEntry timestamp per patient.
    const latestCgm = await prisma.cgmEntry.groupBy({
      by: ["patientId"],
      where: ids ? { patientId: { in: ids } } : undefined,
      _max: { timestamp: true },
    })
    const latestByPatient = new Map(
      latestCgm.map((r) => [r.patientId, r._max.timestamp]),
    )

    // Build candidate flags.
    const flags = new Map<number, PatientAtRiskItem & { _patientId: number }>()
    for (const hp of hypoCounts) {
      if (exclude.has(hp.patientId)) continue
      const count = hp._count.patientId
      if (count >= HYPO_THRESHOLD_7D) {
        flags.set(hp.patientId, {
          _patientId: hp.patientId,
          patientId: hp.patientId,
          patientFirstName: "",
          pathology: null,
          reason: "recentHypos",
          metricLabel: `${count} hypos / 7j`,
          score: 100 + count, // 3+ hypos = base 103
        })
      }
    }

    // Silent monitoring : patients whose latest CGM is older than cutoff,
    // OR patients in portfolio with NO CGM entries at all.
    const portfolioIds = ids ?? Array.from(latestByPatient.keys())
    for (const pid of portfolioIds) {
      if (exclude.has(pid) || flags.has(pid)) continue
      const last = latestByPatient.get(pid)
      if (last === undefined || last === null || last < silentCutoff) {
        const days = last
          ? Math.floor((now.getTime() - last.getTime()) / 86_400_000)
          : Math.max(SILENT_DAYS + 1, 14)
        flags.set(pid, {
          _patientId: pid,
          patientId: pid,
          patientFirstName: "",
          pathology: null,
          reason: "silentMonitoring",
          metricLabel: `${days} j sans saisie`,
          score: 50 + Math.min(50, days), // capped contribution
        })
      }
    }

    const top = Array.from(flags.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, RISK_LIMIT)

    if (top.length === 0) {
      await auditService.log({
        userId: auditUserId, action: "READ", resource: "PATIENT",
        resourceId: "0",
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { kind: "dashboard.medecin.patientsAtRisk", count: 0 },
      })
      return []
    }

    // Hydrate first-name (via User) + pathology for the top N only.
    const patients = await prisma.patient.findMany({
      where: { id: { in: top.map((t) => t.patientId) }, deletedAt: null },
      select: {
        id: true, pathology: true,
        user: { select: { firstname: true } },
      },
    })
    const byId = new Map(patients.map((p) => [p.id, p]))

    // Per-patient audit row (forensic pivot per US-2268).
    await Promise.all(top.map((t) =>
      auditService.log({
        userId: auditUserId, action: "READ", resource: "PATIENT",
        resourceId: String(t.patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: t.patientId,
          kind: "dashboard.medecin.patientsAtRisk",
          reason: t.reason,
        },
      }),
    ))

    return top.map((t) => {
      const p = byId.get(t.patientId)
      return {
        patientId: t.patientId,
        patientFirstName: safeDecryptField(p?.user?.firstname ?? "") ?? "",
        pathology: p?.pathology ?? null,
        reason: t.reason,
        metricLabel: t.metricLabel,
        score: t.score,
      }
    })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2404 — KPI cabinet 14j
// ─────────────────────────────────────────────────────────────

export type KpiCard = {
  /** Stable identifier — drives drill-down navigation. */
  code: "activePatients" | "avgTir" | "weekUrgencies" | "pendingProposals"
  value: number
  /** Optional delta (raw difference vs previous window). */
  delta: number | null
  /** Optional trend direction ; null when no comparable. */
  trend: "up" | "down" | "flat" | null
  unit: string | null
}

// CgmEntry stores `valueGl` in g/L. Thresholds : 70 mg/dL = 0.70 g/L,
// 180 mg/dL = 1.80 g/L (1 g/L = 100 mg/dL). Standard TIR window per ATTD 2019.
const TIR_LOW_GL = 0.70
const TIR_HIGH_GL = 1.80

export const kpisQuery = {
  async forCaller(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<KpiCard[]> {
    const ids = await getAccessiblePatientIds(userId, role)
    const scope = patientScopeWhere(ids)
    if (scope === null) {
      // Empty portfolio → all KPIs zeroed.
      const zero: KpiCard[] = [
        { code: "activePatients", value: 0, delta: null, trend: null, unit: null },
        { code: "avgTir", value: 0, delta: null, trend: null, unit: "%" },
        { code: "weekUrgencies", value: 0, delta: null, trend: null, unit: null },
        { code: "pendingProposals", value: 0, delta: null, trend: null, unit: null },
      ]
      return zero
    }

    const now = new Date()
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000)
    const twentyEightDaysAgo = new Date(now.getTime() - 28 * 86_400_000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
    const fourteenDaysAgoPrev = new Date(now.getTime() - 14 * 86_400_000)

    // 1. Active patients = patient with ≥ 1 CGM entry in last 14d.
    const activeNow = await prisma.cgmEntry.groupBy({
      by: ["patientId"],
      where: {
        ...scope,
        timestamp: { gte: fourteenDaysAgo },
      },
      _count: { _all: true },
    })
    const activePrev = await prisma.cgmEntry.groupBy({
      by: ["patientId"],
      where: {
        ...scope,
        timestamp: { gte: twentyEightDaysAgo, lt: fourteenDaysAgoPrev },
      },
      _count: { _all: true },
    })
    const activeNowCount = activeNow.length
    const activePrevCount = activePrev.length
    const activeDelta = activeNowCount - activePrevCount

    // 2. Avg TIR : aggregate CGM readings last 14d, fraction in [0.70, 1.80] g/L.
    const tirTotalNow = await prisma.cgmEntry.count({
      where: { ...scope, timestamp: { gte: fourteenDaysAgo } },
    })
    const tirInRangeNow = await prisma.cgmEntry.count({
      where: {
        ...scope,
        timestamp: { gte: fourteenDaysAgo },
        valueGl: { gte: TIR_LOW_GL, lte: TIR_HIGH_GL },
      },
    })
    const tirNow = tirTotalNow > 0
      ? Math.round((tirInRangeNow / tirTotalNow) * 1000) / 10
      : 0

    const tirTotalPrev = await prisma.cgmEntry.count({
      where: {
        ...scope,
        timestamp: { gte: twentyEightDaysAgo, lt: fourteenDaysAgoPrev },
      },
    })
    const tirInRangePrev = await prisma.cgmEntry.count({
      where: {
        ...scope,
        timestamp: { gte: twentyEightDaysAgo, lt: fourteenDaysAgoPrev },
        valueGl: { gte: TIR_LOW_GL, lte: TIR_HIGH_GL },
      },
    })
    const tirPrev = tirTotalPrev > 0
      ? Math.round((tirInRangePrev / tirTotalPrev) * 1000) / 10
      : 0
    const tirDelta = tirTotalPrev > 0
      ? Math.round((tirNow - tirPrev) * 10) / 10
      : null

    // 3. Week urgencies = critical alerts triggered last 7 days.
    const weekUrg = await prisma.emergencyAlert.count({
      where: {
        ...scope,
        triggeredAt: { gte: sevenDaysAgo },
        severity: EmergencyAlertSeverity.critical,
      },
    })

    // 4. Pending adjustment proposals in portfolio.
    const pendingProposals = await prisma.adjustmentProposal.count({
      where: {
        ...scope,
        status: "pending",
      },
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.medecin.kpi" },
    })

    return [
      {
        code: "activePatients", value: activeNowCount,
        delta: activeDelta, unit: null,
        trend: activeDelta > 0 ? "up" : activeDelta < 0 ? "down" : "flat",
      },
      {
        code: "avgTir", value: tirNow,
        delta: tirDelta, unit: "%",
        trend: tirDelta === null ? null : tirDelta > 0 ? "up" : tirDelta < 0 ? "down" : "flat",
      },
      {
        code: "weekUrgencies", value: weekUrg,
        delta: null, trend: null, unit: null,
      },
      {
        code: "pendingProposals", value: pendingProposals,
        delta: null, trend: null, unit: null,
      },
    ]
  },
}
