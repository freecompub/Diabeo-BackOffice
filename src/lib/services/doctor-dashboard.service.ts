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
): { patientId?: { in: number[] }; patient?: { deletedAt: null } } | null {
  // healthcare H1 — even for ADMIN, exclude soft-deleted patients to honour
  // RGPD Art. 17 (no resurfacing of erased patients on aggregate dashboards).
  if (ids === null) return { patient: { deletedAt: null } }
  if (ids.length === 0) return null // empty portfolio → no rows
  return { patientId: { in: ids }, patient: { deletedAt: null } }
}

/**
 * code-review L1 — exported so tests can assert criticality invariants.
 * Lower value = higher priority. Ordering matches IDF/EASD severity scale
 * (DKA > severe hypo > moderate ketone > hypo > severe hyper > hyper > manual).
 */
export const CRITICALITY_ORDER: Record<EmergencyAlertType, number> = {
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
    const baseWhere = {
      ...scope,
      status: { in: [EmergencyAlertStatus.open, EmergencyAlertStatus.acknowledged] },
    }
    // healthcare M1 — two-pass : always surface critical-severity alerts
    // (DKA, severe hypo, severe hyper) regardless of trigger time ; then
    // top up with newer non-critical to URGENCY_LIMIT. Eliminates the
    // "DKA hidden behind 50 newer hypers" failure mode.
    const include = {
      patient: {
        select: {
          id: true, pathology: true,
          user: { select: { firstname: true } },
        },
      },
    } as const
    const [criticalRows, recentRows] = await Promise.all([
      prisma.emergencyAlert.findMany({
        where: { ...baseWhere, severity: EmergencyAlertSeverity.critical },
        include,
        orderBy: [{ triggeredAt: "desc" }],
        take: URGENCY_LIMIT,
      }),
      prisma.emergencyAlert.findMany({
        where: baseWhere,
        include,
        orderBy: [{ triggeredAt: "desc" }],
        take: URGENCY_LIMIT * 2,
      }),
    ])
    // Dedupe by id (critical rows are a subset of recent in time) preserving
    // criticalRows first so they survive the limit cut.
    const seen = new Set<number>()
    const merged: typeof criticalRows = []
    for (const r of criticalRows) {
      if (!seen.has(r.id)) { seen.add(r.id); merged.push(r) }
    }
    for (const r of recentRows) {
      if (!seen.has(r.id)) { seen.add(r.id); merged.push(r) }
    }
    const sorted = merged
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
const CABINET_TIMEZONE = "Europe/Paris"

/**
 * code-review C3 / M6 — return [start, end) covering "today" in the cabinet's
 * timezone (Europe/Paris). The `appointment.date` column is `@db.Date`
 * (timezone-naive), so we must build the boundary against Paris wall-clock,
 * not the server's UTC midnight. At 01h Paris (= 23h UTC previous day), the
 * previous UTC-midnight implementation showed yesterday's RDV instead of
 * today's morning slots.
 */
function todayBounds(now = new Date()): { start: Date; end: Date } {
  // Compute the Paris YYYY-MM-DD for `now`, then build the start of that
  // local day and the start of the next local day as UTC instants.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CABINET_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  })
  const parts = fmt.format(now) // "YYYY-MM-DD"
  // `@db.Date` columns are stored as Postgres DATE (no time/tz). Comparing
  // against a UTC-midnight Date works because Prisma serialises Date → DATE
  // via the date portion only. Using UTC midnight of the *Paris-local* date
  // means we filter for the right calendar day.
  const start = new Date(`${parts}T00:00:00Z`)
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

// code-review L6 — dropped `tirDrop` (defined but never produced) ;
//   reintroduce when prior-window TIR per patient is implemented.
export type RiskReason = "recentHypos" | "silentMonitoring"

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
    // healthcare H1 — soft-delete filter on every cross-patient aggregation,
    //   including ADMIN (ids=null).
    const patientFilter = { patient: { deletedAt: null } }
    // code-review M5 — parallelize 3 independent queries (3x latency win).
    // healthcare H2 — for ADMIN with no portfolio restriction, fetch the
    //   full non-deleted patient list to seed silence detection ; otherwise
    //   `Array.from(latestByPatient.keys())` would miss patients with no CGM.
    const [inUrgencyRows, hypoCounts, latestCgm, adminPortfolio] = await Promise.all([
      prisma.emergencyAlert.findMany({
        where: {
          ...(ids ? { patientId: { in: ids } } : {}),
          ...patientFilter,
          status: { in: [EmergencyAlertStatus.open, EmergencyAlertStatus.acknowledged] },
        },
        select: { patientId: true },
        distinct: ["patientId"],
      }),
      prisma.emergencyAlert.groupBy({
        by: ["patientId"],
        where: {
          ...(ids ? { patientId: { in: ids } } : {}),
          ...patientFilter,
          alertType: { in: [EmergencyAlertType.hypo, EmergencyAlertType.severe_hypo] },
          triggeredAt: { gte: sevenDaysAgo },
        },
        _count: { patientId: true },
      }),
      prisma.cgmEntry.groupBy({
        by: ["patientId"],
        where: {
          ...(ids ? { patientId: { in: ids } } : {}),
          ...patientFilter,
        },
        _max: { timestamp: true },
      }),
      // ADMIN seed : full non-deleted patient list (cap 1000 to bound audit
      // explosion). DOCTOR/NURSE rely on their `ids` portfolio.
      ids === null
        ? prisma.patient.findMany({
            where: { deletedAt: null },
            select: { id: true },
            take: 1000,
          })
        : Promise.resolve(null),
    ])
    const exclude = new Set(inUrgencyRows.map((r) => r.patientId))
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
    const portfolioIds = ids ?? (adminPortfolio ?? []).map((p) => p.id)
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

    // healthcare M2 — always emit a summary `resourceId:"0"` audit row,
    //   matching the other 3 dashboard endpoints' telemetry convention.
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.medecin.patientsAtRisk", count: top.length },
    })

    if (top.length === 0) return []

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
    // code-review L8 — `allSettled` so a single audit failure doesn't 500
    //   the dashboard call after data is already computed.
    await Promise.allSettled(top.map((t) =>
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
    // code-review C2 — windowed dates : current 14d window is `[now-14d, now)`,
    //   previous 14d window is `[now-28d, now-14d)`. `fourteenDaysAgo` doubles
    //   as the upper bound of the previous window — no duplicate constant.
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000)
    const twentyEightDaysAgo = new Date(now.getTime() - 28 * 86_400_000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)

    // code-review H3 — 8 independent queries parallelized in one Promise.all
    //   (~6x latency win on first paint vs sequential awaits).
    const [
      activeNow, activePrev,
      tirTotalNow, tirInRangeNow,
      tirTotalPrev, tirInRangePrev,
      weekUrg, pendingProposals,
    ] = await Promise.all([
      prisma.cgmEntry.groupBy({
        by: ["patientId"],
        where: { ...scope, timestamp: { gte: fourteenDaysAgo } },
        _count: { patientId: true },
      }),
      prisma.cgmEntry.groupBy({
        by: ["patientId"],
        where: { ...scope, timestamp: { gte: twentyEightDaysAgo, lt: fourteenDaysAgo } },
        _count: { patientId: true },
      }),
      prisma.cgmEntry.count({
        where: { ...scope, timestamp: { gte: fourteenDaysAgo } },
      }),
      prisma.cgmEntry.count({
        where: {
          ...scope,
          timestamp: { gte: fourteenDaysAgo },
          valueGl: { gte: TIR_LOW_GL, lte: TIR_HIGH_GL },
        },
      }),
      prisma.cgmEntry.count({
        where: { ...scope, timestamp: { gte: twentyEightDaysAgo, lt: fourteenDaysAgo } },
      }),
      prisma.cgmEntry.count({
        where: {
          ...scope,
          timestamp: { gte: twentyEightDaysAgo, lt: fourteenDaysAgo },
          valueGl: { gte: TIR_LOW_GL, lte: TIR_HIGH_GL },
        },
      }),
      prisma.emergencyAlert.count({
        where: {
          ...scope,
          triggeredAt: { gte: sevenDaysAgo },
          severity: EmergencyAlertSeverity.critical,
        },
      }),
      prisma.adjustmentProposal.count({
        where: { ...scope, status: "pending" },
      }),
    ])

    const activeNowCount = activeNow.length
    const activePrevCount = activePrev.length
    const activeDelta = activeNowCount - activePrevCount

    const tirNow = tirTotalNow > 0
      ? Math.round((tirInRangeNow / tirTotalNow) * 1000) / 10
      : 0
    const tirPrev = tirTotalPrev > 0
      ? Math.round((tirInRangePrev / tirTotalPrev) * 1000) / 10
      : 0
    const tirDelta = tirTotalPrev > 0
      ? Math.round((tirNow - tirPrev) * 10) / 10
      : null

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
