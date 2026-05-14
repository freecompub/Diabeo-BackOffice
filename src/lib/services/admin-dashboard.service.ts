/**
 * @module admin-dashboard.service
 * @description Groupe 9b Batch 3 — Dashboard administrateur (3 US, ~19 SP).
 *
 *  - US-2410 page principale (page conteneur — server component)
 *  - US-2412 facturation à traiter (heuristique fallback — US-2107
 *    `Invoice` table NOT STARTED, on utilise `Appointment` +
 *    `TeleconsultationActe` comme proxy "téléconsults non facturées")
 *  - US-2415 sidebar pilotage — l'item est aussi exposé via les
 *    badges KPI (no extra route, NavigationShell reste agnostique)
 *
 * ADMIN-only — gated via `auditedRequireRole(req, "ADMIN", …)` at the
 * route layer (emits US-2265 accessDenied audit on 403). No portfolio
 * scope (ADMIN sees all) but `patient.deletedAt: null` enforced where
 * the join exists (RGPD Art. 17 cascade).
 *
 * ⚠️ Deferrals V2 / V3 :
 *  - US-2107 `Invoice` table (formal billing) — fallback heuristique
 *    via `TeleconsultationActe.invoicedAt IS NULL`
 *  - US-2411 KPI activité cabinet (V3, deps US-2150/US-2200) — placeholder
 *  - US-2413 Conformité RGPD (V3, deps US-2190/2191/2192) — placeholder
 */

import {
  AppointmentStatus,
  BackupStatus,
  UserStatus,
  type Prisma,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"

// code-review L1 (re-review) — extracted date constants.
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const WINDOW_AUDIT_RECENT_DAYS = 7
const WINDOW_ACTIVE_PATIENT_DAYS = 14
const WINDOW_BILLING_DAYS = 30
const WINDOW_COMPLIANCE_HOURS = 24
const WINDOW_FAILED_BACKUPS_DAYS = 30

// ─────────────────────────────────────────────────────────────
// US-2410 — KPI cabinet (admin overview)
// ─────────────────────────────────────────────────────────────

export type AdminKpiCard = {
  code:
    | "totalCabinets"
    | "totalStaff"
    | "totalActivePatients"
    | "auditEventsLast7d"
  value: number
  unit: string | null
}

export const adminKpiQuery = {
  async forCaller(
    auditUserId: number, ctx?: AuditContext,
  ): Promise<AdminKpiCard[]> {
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - WINDOW_AUDIT_RECENT_DAYS * DAY_MS)
    const fourteenDaysAgo = new Date(now.getTime() - WINDOW_ACTIVE_PATIENT_DAYS * DAY_MS)

    const [totalCabinets, totalStaff, totalActivePatientsRows, auditEvents]
      = await Promise.all([
        prisma.healthcareService.count(),
        // code-review M2 (re-review) — staff = HealthcareMember linked to a
        //   non-archived/non-suspended User. `HealthcareMember.user` is not
        //   declared as a Prisma relation field, so we resolve via a 2-step
        //   query : fetch active user IDs, then count members linked to them.
        prisma.user.findMany({
          where: { status: UserStatus.active },
          select: { id: true },
        }).then((users) =>
          prisma.healthcareMember.count({
            where: { userId: { in: users.map((u) => u.id) } },
          }),
        ),
        // code-review H2 (re-review) — `COUNT(DISTINCT patient_id)` via
        //   raw SQL avoids allocating a 50k-tuple JS array on each poll.
        //   Joins `patients` to enforce soft-delete (`deleted_at IS NULL`).
        prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(DISTINCT ce.patient_id) AS count
            FROM cgm_entries ce
            JOIN patients p ON p.id = ce.patient_id
           WHERE ce.timestamp >= ${fourteenDaysAgo}
             AND p.deleted_at IS NULL
        `,
        prisma.auditLog.count({
          where: { createdAt: { gte: sevenDaysAgo } },
        }),
      ])
    const totalActivePatients = Number(totalActivePatientsRows[0]?.count ?? 0)

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.admin.kpi" },
    })

    return [
      { code: "totalCabinets", value: totalCabinets, unit: null },
      { code: "totalStaff", value: totalStaff, unit: null },
      { code: "totalActivePatients", value: totalActivePatients, unit: null },
      { code: "auditEventsLast7d", value: auditEvents, unit: null },
    ]
  },
}

// ─────────────────────────────────────────────────────────────
// US-2412 — Facturation à traiter (heuristique fallback)
// ─────────────────────────────────────────────────────────────

export type BillingMetric = {
  /** Total teleconsults eligible for billing (status=completed, location=video). */
  totalEligible: number
  /** Teleconsults eligible but never billed (`TeleconsultationActe.invoicedAt IS NULL`). */
  unbilledCount: number
  /** Teleconsults billed (invoicedAt IS NOT NULL) and not yet 30d old. */
  recentlyBilled: number
  /** Sum of amountCents for unbilled teleconsults (€ cents). */
  unbilledAmountCents: number
}

export const billingMetricsQuery = {
  async forCaller(
    auditUserId: number, ctx?: AuditContext,
  ): Promise<BillingMetric> {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - WINDOW_BILLING_DAYS * DAY_MS)
    // code-review (V2 follow-up) — proper `Invoice` table awaited via US-2107.
    //   Today : count completed video appointments + match against
    //   `TeleconsultationActe.invoicedAt` to derive unbilled vs billed.
    const completedFilter: Prisma.AppointmentWhereInput = {
      status: AppointmentStatus.completed,
      location: "video",
      patient: { deletedAt: null },
    }
    const [totalEligible, unbilledActes, recentlyBilledActes, unbilledAmount]
      = await Promise.all([
        prisma.appointment.count({ where: completedFilter }),
        prisma.teleconsultationActe.count({
          where: {
            invoicedAt: null,
            appointment: completedFilter,
          },
        }),
        // code-review H1 (re-review) — chain `completedFilter` so this count
        //   stays semantically aligned with `totalEligible` (only counts
        //   billed actes on completed video appointments).
        prisma.teleconsultationActe.count({
          where: {
            invoicedAt: { gte: thirtyDaysAgo },
            appointment: completedFilter,
          },
        }),
        prisma.teleconsultationActe.aggregate({
          where: {
            invoicedAt: null,
            appointment: completedFilter,
          },
          _sum: { amountCents: true },
        }),
      ])

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "APPOINTMENT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.admin.billing" },
    })

    return {
      totalEligible,
      unbilledCount: unbilledActes,
      recentlyBilled: recentlyBilledActes,
      unbilledAmountCents: unbilledAmount._sum.amountCents ?? 0,
    }
  },
}

// ─────────────────────────────────────────────────────────────
// Compliance snapshot — BackupLog + AuditLog
// ─────────────────────────────────────────────────────────────

export type ComplianceSnapshot = {
  lastBackupAt: Date | null
  lastBackupStatus: BackupStatus | null
  /** Audit log volume in last 24h. */
  auditEventsLast24h: number
  /** Failed-backup count in last 30 days (HDS Art. 32 monitoring). */
  failedBackupsLast30d: number
}

export const complianceQuery = {
  async forCaller(
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ComplianceSnapshot> {
    const now = new Date()
    const twentyFourHoursAgo = new Date(now.getTime() - WINDOW_COMPLIANCE_HOURS * HOUR_MS)
    const thirtyDaysAgo = new Date(now.getTime() - WINDOW_FAILED_BACKUPS_DAYS * DAY_MS)

    const [lastBackup, auditEvents, failedBackups] = await Promise.all([
      // code-review M1 (re-review) — filter `completedAt: { not: null }` :
      //   Postgres `ORDER BY DESC` defaults to NULLS FIRST. A row marked
      //   `status=completed` before the worker fills `completedAt` would
      //   surface as the "latest backup" but render as "Aucun backup".
      prisma.backupLog.findFirst({
        where: {
          status: BackupStatus.completed,
          completedAt: { not: null },
        },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true, status: true },
      }),
      prisma.auditLog.count({
        where: { createdAt: { gte: twentyFourHoursAgo } },
      }),
      prisma.backupLog.count({
        where: {
          status: BackupStatus.failed,
          startedAt: { gte: thirtyDaysAgo },
        },
      }),
    ])

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "AUDIT_LOG",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.admin.compliance" },
    })

    return {
      lastBackupAt: lastBackup?.completedAt ?? null,
      lastBackupStatus: lastBackup?.status ?? null,
      auditEventsLast24h: auditEvents,
      failedBackupsLast30d: failedBackups,
    }
  },
}
