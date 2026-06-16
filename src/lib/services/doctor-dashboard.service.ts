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
  ProposalStatus,
  type AdjustableParameter,
  type Prisma,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { getAccessiblePatientIds } from "@/lib/access-control"
import { auditService, type AuditContext } from "./audit.service"
import { messagingService, MESSAGING_BOUNDS } from "./messaging.service"
import { safeDecryptField } from "@/lib/crypto/fields"
import { todayBounds } from "@/lib/cabinet-time"
import type { GlucoseUnit } from "@/lib/conversions"
import type { Role } from "@prisma/client"

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Build the patient-portfolio `WHERE` clause for cross-patient queries.
 * Returns `{}` for ADMIN (no restriction) ; otherwise an `IN` filter.
 * Empty array → forces no rows (caller has empty portfolio).
 */
/**
 * Build the patient-portfolio `WHERE` clause for cross-patient queries.
 *
 * **Three return states** (code-review L1 re-review — discriminated by
 * caller via null check + presence of `patientId`) :
 *  - `null`       → caller's portfolio is empty ; query should be skipped
 *                    to avoid scanning the whole table.
 *  - `{ patient: { deletedAt: null } }`
 *                 → ADMIN, no portfolio restriction beyond soft-delete.
 *  - `{ patientId: { in: ids }, patient: { deletedAt: null } }`
 *                 → DOCTOR/NURSE, restricted to managed patients.
 *
 * **healthcare H1** — even for ADMIN, exclude soft-deleted patients to
 * honour RGPD Art. 17 (no resurfacing of erased patients on aggregate
 * dashboards).
 *
 * Callers MUST NOT redeclare a `patient:` relation filter at the call site
 * — it would silently override the one inserted here (re-review H1).
 */
function patientScopeWhere(
  ids: number[] | null,
): { patientId?: { in: number[] }; patient?: { deletedAt: null } } | null {
  if (ids === null) return { patient: { deletedAt: null } }
  if (ids.length === 0) return null
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
    // code-review M1 (re-review) — uncap `criticalRows` to a generous
    //   ceiling (50) instead of `URGENCY_LIMIT=5`. A mass-event scenario
    //   (sensor outage, multi-patient DKA on a heatwave) shouldn't hide
    //   the 6th critical alert behind newer non-critical noise. 50 is large
    //   enough to dominate the URGENCY_LIMIT slice and small enough to
    //   bound query cost.
    const CRITICAL_OVERFETCH = 50
    const [criticalRows, recentRows] = await Promise.all([
      prisma.emergencyAlert.findMany({
        where: { ...baseWhere, severity: EmergencyAlertSeverity.critical },
        include,
        orderBy: [{ triggeredAt: "desc" }],
        take: CRITICAL_OVERFETCH,
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

    // code-review M2 (re-review) — summary + per-patient pivot.
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "EMERGENCY_ALERT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.medecin.urgencies", count: sorted.length },
    })
    await Promise.allSettled(sorted.map((r) =>
      auditService.log({
        userId: auditUserId, action: "READ", resource: "EMERGENCY_ALERT",
        resourceId: String(r.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: r.patientId,
          kind: "dashboard.medecin.urgencies",
        },
      }),
    ))

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

export const appointmentsQuery = {
  async forCaller(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<AppointmentItem[]> {
    const ids = await getAccessiblePatientIds(userId, role)
    const scope = patientScopeWhere(ids)
    if (scope === null) return []
    const { start, end } = todayBounds()
    // code-review H1 (re-review) — `scope` already carries
    //   `patient: { deletedAt: null }` ; don't override it here. Adding a
    //   literal `patient:` below would silently drop any future sub-filter
    //   introduced in `patientScopeWhere` (e.g. status filtering).
    const where: Prisma.AppointmentWhereInput = {
      ...scope,
      date: { gte: start, lt: end },
      status: { in: [AppointmentStatus.scheduled, AppointmentStatus.pending_validation] },
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

    // code-review M2 (re-review) — emit both summary AND per-patient pivot
    //   audit rows. Appointments expose decrypted firstname + pathology per
    //   patient ; CNIL forensic query "who saw patient X today" must surface
    //   the dashboard view via `auditService.getByPatient(X)` (ADR #18).
    //   KPI stays summary-only (aggregate metrics, no per-patient PHI).
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "APPOINTMENT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.medecin.appointments", count: rows.length },
    })
    await Promise.allSettled(rows.map((r) =>
      auditService.log({
        userId: auditUserId, action: "READ", resource: "APPOINTMENT",
        resourceId: String(r.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: r.patientId,
          kind: "dashboard.medecin.appointments",
        },
      }),
    ))

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
  /** Free-form metric label (e.g. "4 hypos / 7j", "12 jours sans saisie").
   * Kept for non-localized consumers (e.g. nurse recall list). The medecin
   * dashboard localizes via {@link PatientAtRiskItem.metricValue} + i18n. */
  metricLabel: string
  /** Raw count behind {@link PatientAtRiskItem.metricLabel} (hypos or days),
   * so the client can render a locale-aware label (i18n dashboard médecin). */
  metricValue: number
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
          metricValue: count,
          score: 100 + count, // 3+ hypos = base 103
        })
      }
    }

    // Silent monitoring : patients whose latest CGM is older than cutoff,
    // OR patients in portfolio with NO CGM entries at all.
    // code-review L2 (re-review) — `last === null` retained at the type
    //   level (Map value type from `_max.timestamp` is `Date | null`)
    //   though semantically dead : the column is `@db.Timestamptz()`
    //   non-null, so a row only exists with a non-null timestamp.
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
          metricValue: days,
          score: 50 + Math.min(50, days), // capped contribution
        })
      }
    }

    const top = Array.from(flags.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, RISK_LIMIT)

    // healthcare M2 — always emit a summary `resourceId:"0"` audit row,
    //   matching the other 3 dashboard endpoints' telemetry convention.
    // code-review L4 (re-review) — flag when the ADMIN seed list was
    //   truncated at 1000 so forensics knows the silent-monitoring count
    //   under-reports.
    const adminTruncated = ids === null && (adminPortfolio?.length ?? 0) >= 1000
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: {
        kind: "dashboard.medecin.patientsAtRisk",
        count: top.length,
        ...(adminTruncated ? { wasTruncated: true } : {}),
      },
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
        metricValue: t.metricValue,
        score: t.score,
      }
    })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2603 — Drapeaux d'alerte mono-patient (barre de contexte)
// ─────────────────────────────────────────────────────────────

/** Drapeaux d'alerte d'UN patient pour la barre de contexte (US-2603). */
export type PatientFlags = {
  /** ≥ {@link HYPO_THRESHOLD_7D} hypos sur 7 j. */
  recentHypos: boolean
  hypoCount: number
  /** Aucune saisie CGM depuis ≥ {@link SILENT_DAYS} jours (ou jamais). */
  silentMonitoring: boolean
  /** Jours depuis le dernier relevé CGM ; null si aucun relevé. */
  silentDays: number | null
  /** Urgence en cours (open/acknowledged). */
  openUrgency: boolean
}

/**
 * Drapeaux d'alerte d'un patient pour la barre de contexte (US-2603).
 *
 * SOURCE UNIQUE des seuils/prédicats partagée avec « Ma journée »
 * (`patientsAtRiskQuery`/`urgenciesQuery`) — mêmes constantes
 * {@link HYPO_THRESHOLD_7D}/{@link SILENT_DAYS}, mêmes types d'alerte → pas de
 * dérive entre la worklist cohorte et la barre mono-patient.
 *
 * L'appelant a déjà vérifié l'accès (`canAccessPatient`) et l'audit READ PATIENT
 * (via `patientService.getById`) couvre la consultation — pas d'audit dédié ici
 * (signal dérivé : comptes/horodatage, aucune PHI).
 */
export async function getPatientFlags(patientId: number): Promise<PatientFlags> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
  const silentCutoff = new Date(now.getTime() - SILENT_DAYS * 86_400_000)
  const [openUrgencyCount, hypoCount, latestCgm] = await Promise.all([
    // NB : compte TOUTES les sévérités d'alerte en cours (≠ `urgenciesQuery` qui
    // surface les critiques en tête) — pour la barre, toute urgence ouverte est un
    // drapeau. Choix produit assumé, pas une dérive vs la worklist.
    prisma.emergencyAlert.count({
      where: {
        patientId,
        status: { in: [EmergencyAlertStatus.open, EmergencyAlertStatus.acknowledged] },
      },
    }),
    prisma.emergencyAlert.count({
      where: {
        patientId,
        alertType: { in: [EmergencyAlertType.hypo, EmergencyAlertType.severe_hypo] },
        triggeredAt: { gte: sevenDaysAgo },
      },
    }),
    prisma.cgmEntry.aggregate({ where: { patientId }, _max: { timestamp: true } }),
  ])
  const last = latestCgm._max.timestamp
  return {
    recentHypos: hypoCount >= HYPO_THRESHOLD_7D,
    hypoCount,
    silentMonitoring: last == null || last < silentCutoff,
    silentDays: last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null,
    openUrgency: openUrgencyCount > 0,
  }
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
    // code-review H2 (re-review) — only compute delta when BOTH windows
    //   have data. Otherwise a quiet portfolio (no CGM uploads this
    //   fortnight) would surface a fake "down trend" of -tirPrev. Clinical
    //   UX risk: doctor sees catastrophic drop on a stable patient.
    const tirDelta = tirTotalNow > 0 && tirTotalPrev > 0
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

// ─────────────────────────────────────────────────────────────
// US-2602 (Ma journée) — Propositions d'ajustement en attente (liste)
// ─────────────────────────────────────────────────────────────

export type PendingProposalItem = {
  id: string
  patientId: number
  patientFirstName: string
  pathology: string | null
  parameterType: AdjustableParameter
  currentValue: number
  proposedValue: number
  changePercent: number
  createdAt: Date
  /**
   * Unité de glycémie préférée de l'APPELANT (médecin), pas du patient — sert
   * à afficher l'ISF dans la bonne unité (g/L/U, mg/dL/U ou mmol/L/U). Les
   * valeurs `currentValue`/`proposedValue` restent en g/L (stockage canonique) ;
   * la conversion d'affichage est faite côté carte.
   */
  glucoseUnit: GlucoseUnit
}

const PENDING_PROPOSALS_LIMIT = 5

/** Code `unitGlycemia` (UserUnitPreferences) → unité d'affichage glycémie.
 *  3:g/L 4:mg/dL 5:mmol/L. Défaut (préf. absente) = mg/dL, cohérent avec les
 *  autres cartes du dashboard médecin (EmergencyCard). */
function glucoseUnitFromCode(code: number | undefined): GlucoseUnit {
  return code === 3 ? "g/L" : code === 5 ? "mmol/L" : "mg/dL"
}

/**
 * Liste les propositions d'ajustement **en attente** du portefeuille du caller
 * (déterministe ; `AdjustmentProposal` produites par le graphe d'orchestration
 * backend, jamais par le frontend). Scopé via `getAccessiblePatientIds`.
 */
export const pendingProposalsQuery = {
  async forCaller(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<PendingProposalItem[]> {
    const ids = await getAccessiblePatientIds(userId, role)
    const scope = patientScopeWhere(ids)
    if (scope === null) return []
    // `scope` porte déjà `patient: { deletedAt: null }` — ne pas le redéclarer.
    const where: Prisma.AdjustmentProposalWhereInput = {
      ...scope,
      status: ProposalStatus.pending,
    }
    const rows = await prisma.adjustmentProposal.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true, pathology: true,
            user: { select: { firstname: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: PENDING_PROPOSALS_LIMIT,
    })

    // Unité d'affichage ISF = préférence glycémie de l'appelant (lookup unique
    // indexé). Évité quand il n'y a aucune ligne à afficher.
    const prefRow = rows.length
      ? await prisma.userUnitPreferences.findUnique({
          where: { userId }, select: { unitGlycemia: true },
        })
      : null
    const glucoseUnit = glucoseUnitFromCode(prefRow?.unitGlycemia)

    // Audit : résumé + pivot par patient (PHI : prénom déchiffré exposé).
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "ADJUSTMENT_PROPOSAL",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.medecin.pendingProposals", count: rows.length },
    })
    await Promise.allSettled(rows.map((r) =>
      auditService.log({
        userId: auditUserId, action: "READ", resource: "ADJUSTMENT_PROPOSAL",
        resourceId: r.id,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: r.patientId, kind: "dashboard.medecin.pendingProposals" },
      }),
    ))

    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      patientFirstName: safeDecryptField(r.patient.user.firstname ?? "") ?? "",
      pathology: r.patient.pathology,
      parameterType: r.parameterType,
      currentValue: Number(r.currentValue),
      proposedValue: Number(r.proposedValue),
      changePercent: Number(r.changePercent),
      createdAt: r.createdAt,
      glucoseUnit,
    }))
  },
}

// ─────────────────────────────────────────────────────────────
// US-2602 (Ma journée) — Messages non lus (liste)
// ─────────────────────────────────────────────────────────────

export type UnreadThreadItem = {
  conversationKey: string
  otherUserId: number
  /** Réf. patient opaque (8 chars) si le thread contextualise un patient. */
  patientPublicRef: string | null
  preview: string
  previewTruncated: boolean
  unreadCount: number
  lastMessageAt: Date
}

const UNREAD_THREADS_LIMIT = 5

/**
 * Threads avec au moins un message non lu pour le caller, triés par
 * récence (top {@link UNREAD_THREADS_LIMIT}). Réutilise
 * `messagingService.listThreads` avec le trigger `"poll"` (audit coalescé —
 * pas de pollution `audit_logs` sur le polling 60s de la carte dashboard).
 * Déterministe : aucune génération de contenu côté frontend.
 */
export const unreadThreadsQuery = {
  async forCaller(userId: number, ctx: AuditContext): Promise<UnreadThreadItem[]> {
    const threads = await messagingService.listThreads(
      userId, ctx, MESSAGING_BOUNDS.MAX_THREADS_PER_QUERY, "poll",
    )
    return threads
      .filter((t) => t.unreadCount > 0)
      .slice(0, UNREAD_THREADS_LIMIT)
      .map((t) => ({
        conversationKey: t.conversationKey,
        otherUserId: t.otherUserId,
        patientPublicRef: t.patientPublicRef,
        preview: t.lastMessage.bodyPreview,
        previewTruncated: t.lastMessage.bodyPreviewTruncated,
        unreadCount: t.unreadCount,
        lastMessageAt: t.lastMessage.createdAt,
      }))
  },
}
