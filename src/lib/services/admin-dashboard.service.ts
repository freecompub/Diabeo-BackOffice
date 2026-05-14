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
 * ADMIN-only — `requireRole(req, "ADMIN")` ; pas de portfolio scope
 * (ADMIN voit tout) mais `patient.deletedAt: null` respecté.
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
  type Prisma,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"

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
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000)

    const [totalCabinets, totalStaff, totalActivePatients, auditEvents]
      = await Promise.all([
        prisma.healthcareService.count(),
        // HealthcareMember has no `active` boolean ; count rows with a
        // linked `userId` (≃ active backoffice member).
        prisma.healthcareMember.count({
          where: { userId: { not: null } },
        }),
        // Active patient = at least one CGM entry in last 14d.
        prisma.cgmEntry.groupBy({
          by: ["patientId"],
          where: {
            timestamp: { gte: fourteenDaysAgo },
            patient: { deletedAt: null },
          },
          _count: { patientId: true },
        }).then((g) => g.length),
        prisma.auditLog.count({
          where: { createdAt: { gte: sevenDaysAgo } },
        }),
      ])

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
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000)
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
        prisma.teleconsultationActe.count({
          where: {
            invoicedAt: { gte: thirtyDaysAgo },
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
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600_000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000)

    const [lastBackup, auditEvents, failedBackups] = await Promise.all([
      prisma.backupLog.findFirst({
        where: { status: BackupStatus.completed },
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
