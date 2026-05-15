/**
 * @module device-supervision.service
 * @description Groupe 1 — US-2243 Supervision dispositifs.
 *
 * Vue tabulaire des dispositifs déclarés par le patient avec statut :
 * modèle, n° série, dernière sync, état pile, expiration capteur.
 * Disponible en 2 portées : par patient (DOCTOR/NURSE détail clinique)
 * et cohorte (NURSE+ supervision quotidienne — capteurs expirant,
 * pile faible).
 *
 * Audit US-2268 : `resourceId = device.id`, `metadata.patientId` pivot.
 */

import type { Role, DeviceCategory, PatientDevice } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { canAccessPatient, getAccessiblePatientIds } from "@/lib/access-control"
import { auditService, type AuditContext } from "./audit.service"

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type DeviceSupervisionAuditKind =
  | "device_supervision.read.patient"
  | "device_supervision.read.cohort"

const AUDIT_KIND = {
  READ_PATIENT: "device_supervision.read.patient",
  READ_COHORT: "device_supervision.read.cohort",
} as const satisfies Record<string, DeviceSupervisionAuditKind>

export class DeviceSupervisionAccessError extends Error {
  constructor(message = "forbidden") {
    super(message)
    this.name = "DeviceSupervisionAccessError"
  }
}

/**
 * Bornes & seuils :
 * - `BATTERY_LOW_PCT` : seuil pile faible (UX badge orange).
 * - `SENSOR_EXPIRES_SOON_DAYS` : préavis expiration capteur (J-3).
 */
export const SUPERVISION_BOUNDS = {
  BATTERY_LOW_PCT: 20,
  SENSOR_EXPIRES_SOON_DAYS: 3,
  MAX_COHORT_LIMIT: 500,
} as const

export interface DeviceSupervisionDTO {
  id: number
  patientId: number
  brand: string | null
  name: string | null
  model: string | null
  sn: string | null
  type: string | null
  category: DeviceCategory | null
  batteryLevel: number | null
  /** `true` si batteryLevel < BATTERY_LOW_PCT. */
  batteryLow: boolean
  sensorExpiresAt: Date | null
  /** `true` si sensorExpiresAt < now + 3j. */
  sensorExpiringSoon: boolean
  lastSyncAt: Date | null
  createdAt: Date | null
}

export interface CohortFilters {
  /** Filtrer les devices dont battery < threshold (default BATTERY_LOW_PCT). */
  batteryLow?: boolean
  /** Filtrer les capteurs expirant dans X jours. */
  sensorExpiringSoon?: boolean
  /** Restreindre par catégorie (CGM, PUMP, BGM, etc.). */
  category?: DeviceCategory
  limit?: number
  cursor?: number
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function toDTO(d: PatientDevice & { createdAt?: Date | null }): DeviceSupervisionDTO {
  const now = Date.now()
  const expiresInMs = d.sensorExpiresAt
    ? d.sensorExpiresAt.getTime() - now
    : null
  const sensorExpiringSoon = expiresInMs !== null
    && expiresInMs <= SUPERVISION_BOUNDS.SENSOR_EXPIRES_SOON_DAYS * 86_400_000
  return {
    id: d.id,
    patientId: d.patientId,
    brand: d.brand,
    name: d.name,
    model: d.model,
    sn: d.sn,
    type: d.type,
    category: d.category,
    batteryLevel: d.batteryLevel,
    batteryLow: d.batteryLevel !== null && d.batteryLevel < SUPERVISION_BOUNDS.BATTERY_LOW_PCT,
    sensorExpiresAt: d.sensorExpiresAt,
    sensorExpiringSoon,
    lastSyncAt: d.lastSyncAt,
    createdAt: d.date ?? null,
  }
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const deviceSupervisionService = {
  /**
   * Liste les dispositifs d'un patient. RBAC : VIEWER own / NURSE+
   * cabinet via canAccessPatient. Audit READ avec pivot patientId.
   */
  async listByPatient(
    patientId: number,
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<DeviceSupervisionDTO[]> {
    const allowed = await canAccessPatient(auditUserId, auditUserRole, patientId)
    if (!allowed) throw new DeviceSupervisionAccessError("notPatientCaregiver")

    const rows = await prisma.patientDevice.findMany({
      where: { patientId },
      orderBy: [{ category: "asc" }, { id: "desc" }],
    })

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
        count: rows.length,
      },
    })

    return rows.map(toDTO)
  },

  /**
   * Vue cohorte : tous les dispositifs des patients accessibles au
   * caller (via `getAccessiblePatientIds`). ADMIN = pas de restriction.
   *
   * Filtres optionnels :
   *   - `batteryLow=true` → battery_level < BATTERY_LOW_PCT
   *   - `sensorExpiringSoon=true` → sensor_expires_at ≤ now + 3j
   *   - `category=cgm|pump|bgm`
   *
   * Capping : MAX_COHORT_LIMIT=500 (anti-exfil).
   */
  async listCohort(
    filters: CohortFilters,
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<DeviceSupervisionDTO[]> {
    const accessible = await getAccessiblePatientIds(auditUserId, auditUserRole)
    if (accessible !== null && accessible.length === 0) return []

    const limit = Math.min(filters.limit ?? 50, SUPERVISION_BOUNDS.MAX_COHORT_LIMIT)
    const sensorExpiryCutoff = new Date(
      Date.now() + SUPERVISION_BOUNDS.SENSOR_EXPIRES_SOON_DAYS * 86_400_000,
    )

    const rows = await prisma.patientDevice.findMany({
      where: {
        ...(accessible !== null ? { patientId: { in: accessible } } : {}),
        ...(filters.batteryLow ? { batteryLevel: { lt: SUPERVISION_BOUNDS.BATTERY_LOW_PCT } } : {}),
        ...(filters.sensorExpiringSoon ? { sensorExpiresAt: { lte: sensorExpiryCutoff, not: null } } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        patient: { deletedAt: null },
      },
      orderBy: [{ patientId: "asc" }, { id: "desc" }],
      take: limit,
      ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "DEVICE",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        kind: AUDIT_KIND.READ_COHORT,
        count: rows.length,
        accessibleScope: accessible === null ? "all" : accessible.length,
        ...(filters.batteryLow ? { batteryLow: true } : {}),
        ...(filters.sensorExpiringSoon ? { sensorExpiringSoon: true } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        limit,
      },
    })

    return rows.map(toDTO)
  },
}
