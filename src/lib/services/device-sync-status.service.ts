/**
 * @module device-sync-status.service
 * @description Groupe 1 — US-2244 Statut sync temps-réel.
 *
 * Indicateur live de fraîcheur des données par patient :
 *   - OK       : dernière sync < 5 min
 *   - LATE     : 5-30 min
 *   - CRITICAL : > 30 min sans sync
 *
 * Calculé depuis `PatientDevice.lastSyncAt` (max sur tous les devices
 * du patient — c'est suffisant qu'AU MOINS UN device sync pour qu'on
 * considère le patient "joignable").
 *
 * Filtre cohorte par status pour le dashboard supervision NURSE+.
 *
 * Audit US-2268 : `metadata.patientId` pivot.
 */

import type { Role } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { canAccessPatient, getAccessiblePatientIds } from "@/lib/access-control"
import { auditService, type AuditContext } from "./audit.service"

// ─────────────────────────────────────────────────────────────
// Types & seuils
// ─────────────────────────────────────────────────────────────

export type SyncStatus = "ok" | "late" | "critical" | "never_synced"

export type SyncStatusAuditKind =
  | "device_sync_status.read.patient"
  | "device_sync_status.read.cohort"

const AUDIT_KIND = {
  READ_PATIENT: "device_sync_status.read.patient",
  READ_COHORT: "device_sync_status.read.cohort",
} as const satisfies Record<string, SyncStatusAuditKind>

export class SyncStatusAccessError extends Error {
  constructor(message = "forbidden") {
    super(message)
    this.name = "SyncStatusAccessError"
  }
}

/**
 * Seuils US-2244 :
 *   - OK_MAX_MIN       : 5 min — fraîcheur normale
 *   - LATE_MAX_MIN     : 30 min — retard, vigilance
 *   - > LATE_MAX_MIN   : critique
 */
export const SYNC_STATUS_BOUNDS = {
  OK_MAX_MIN: 5,
  LATE_MAX_MIN: 30,
  MAX_COHORT_LIMIT: 500,
} as const

export interface PatientSyncStatusDTO {
  patientId: number
  status: SyncStatus
  lastSyncAt: Date | null
  /** Minutes écoulées depuis lastSyncAt (null si never_synced). */
  minutesSinceLastSync: number | null
}

export interface CohortFilters {
  /** Restreindre à un sous-ensemble de status. */
  statuses?: SyncStatus[]
  limit?: number
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function computeStatus(lastSyncAt: Date | null, now: number): {
  status: SyncStatus
  minutesSinceLastSync: number | null
} {
  if (!lastSyncAt) {
    return { status: "never_synced", minutesSinceLastSync: null }
  }
  const minutesSinceLastSync = Math.floor((now - lastSyncAt.getTime()) / 60_000)
  if (minutesSinceLastSync < SYNC_STATUS_BOUNDS.OK_MAX_MIN) {
    return { status: "ok", minutesSinceLastSync }
  }
  if (minutesSinceLastSync <= SYNC_STATUS_BOUNDS.LATE_MAX_MIN) {
    return { status: "late", minutesSinceLastSync }
  }
  return { status: "critical", minutesSinceLastSync }
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const deviceSyncStatusService = {
  /**
   * Pure helper for tests / re-use. Exported so cohort tooling et
   * dashboards backoffice partagent la même définition des seuils.
   */
  computeStatus,

  /**
   * Statut sync d'un patient. RBAC : VIEWER own / NURSE+ cabinet.
   * Prend le MAX(lastSyncAt) sur tous ses devices.
   */
  async getStatus(
    patientId: number,
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<PatientSyncStatusDTO> {
    const allowed = await canAccessPatient(auditUserId, auditUserRole, patientId)
    if (!allowed) throw new SyncStatusAccessError("notPatientCaregiver")

    const agg = await prisma.patientDevice.aggregate({
      where: { patientId },
      _max: { lastSyncAt: true },
    })
    const lastSyncAt = agg._max.lastSyncAt
    const { status, minutesSinceLastSync } = computeStatus(lastSyncAt, Date.now())

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "DEVICE",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        patientId,
        kind: AUDIT_KIND.READ_PATIENT,
        status,
        ...(minutesSinceLastSync !== null ? { minutesSinceLastSync } : {}),
      },
    })

    return { patientId, status, lastSyncAt, minutesSinceLastSync }
  },

  /**
   * Cohort sync status — un row par patient accessible avec son status.
   * Inclut les patients SANS device (status = `never_synced`).
   *
   * **H3 (review re-1 PR #408)** : un patient critique sans appairage
   * doit apparaître au dashboard supervision NURSE+, sinon il "passe
   * sous les radars". Pour DOCTOR/NURSE/VIEWER, on enumère les IDs
   * accessibles puis on merge avec les agg-groupBy.
   *
   * Pour ADMIN (`accessible === null`), on ne peut pas enumérer la
   * table `Patient` complète (potentiellement 50k+ rows). Comportement
   * documenté : ADMIN cohortStatus se restreint aux patients ayant ≥1
   * device entry. Audit metadata `adminEnumerationLimited=true` pour
   * forensique transparente.
   *
   * **M3 (review re-1)** : ordre tri = critical → late → never_synced
   * → ok (un patient never_synced est plus alarmant qu'un patient OK).
   *
   * @perf cohortes ≤ 1000 patients OK (tri/slice in-memory).
   */
  async cohortStatus(
    filters: CohortFilters,
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<PatientSyncStatusDTO[]> {
    const accessible = await getAccessiblePatientIds(auditUserId, auditUserRole)
    if (accessible !== null && accessible.length === 0) return []

    const limit = Math.min(filters.limit ?? 100, SYNC_STATUS_BOUNDS.MAX_COHORT_LIMIT)

    // groupBy patientId pour récupérer le max(lastSyncAt) par patient.
    const rows = await prisma.patientDevice.groupBy({
      by: ["patientId"],
      where: {
        ...(accessible !== null ? { patientId: { in: accessible } } : {}),
        patient: { deletedAt: null },
      },
      _max: { lastSyncAt: true },
    })

    const now = Date.now()
    let results: PatientSyncStatusDTO[] = rows.map((r) => {
      const { status, minutesSinceLastSync } = computeStatus(r._max.lastSyncAt, now)
      return {
        patientId: r.patientId,
        status,
        lastSyncAt: r._max.lastSyncAt,
        minutesSinceLastSync,
      }
    })

    // H3 (review re-1 PR #408) — pour les rôles non-ADMIN, on enumère
    // les IDs accessibles et on ajoute les patients SANS device entry
    // comme `never_synced`.
    let adminEnumerationLimited = false
    if (accessible !== null) {
      const patientsWithDevices = new Set(rows.map((r) => r.patientId))
      const missingPatients = accessible.filter((id) => !patientsWithDevices.has(id))
      for (const patientId of missingPatients) {
        results.push({
          patientId,
          status: "never_synced",
          lastSyncAt: null,
          minutesSinceLastSync: null,
        })
      }
    } else {
      adminEnumerationLimited = true
    }

    if (filters.statuses && filters.statuses.length > 0) {
      const filter = new Set(filters.statuses)
      results = results.filter((r) => filter.has(r.status))
    }

    // M3 — Ordre tri : critical → late → never_synced → ok (un patient
    // jamais sync est plus alarmant qu'un patient OK).
    const order: Record<SyncStatus, number> = {
      critical: 0, late: 1, never_synced: 2, ok: 3,
    }
    results.sort((a, b) => order[a.status] - order[b.status])
    results = results.slice(0, limit)

    // M4 (review re-1) — scope discriminated union typé.
    const scopeMetadata = accessible === null
      ? { scope: "all" as const }
      : { scope: "scoped" as const, accessibleCount: accessible.length }

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "DEVICE",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        kind: AUDIT_KIND.READ_COHORT,
        count: results.length,
        ...scopeMetadata,
        ...(adminEnumerationLimited ? { adminEnumerationLimited: true } : {}),
        ...(filters.statuses ? { statusFilter: filters.statuses } : {}),
        limit,
      },
    })

    return results
  },
}
