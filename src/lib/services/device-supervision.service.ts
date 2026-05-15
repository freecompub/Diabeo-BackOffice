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
  | "device_supervision.sync_ping"

const AUDIT_KIND = {
  READ_PATIENT: "device_supervision.read.patient",
  READ_COHORT: "device_supervision.read.cohort",
  SYNC_PING: "device_supervision.sync_ping",
} as const satisfies Record<string, DeviceSupervisionAuditKind>

export class DeviceSupervisionAccessError extends Error {
  constructor(message = "forbidden") {
    super(message)
    this.name = "DeviceSupervisionAccessError"
  }
}

export class DeviceSupervisionNotFoundError extends Error {
  constructor() {
    super("deviceNotFound")
    this.name = "DeviceSupervisionNotFoundError"
  }
}

export class DeviceSupervisionValidationError extends Error {
  constructor(public field: string) {
    super(field)
    this.name = "DeviceSupervisionValidationError"
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
  /** M2 — `true` si `sensorExpiresAt < now` (déjà expiré, rappel urgent). */
  sensorExpired: boolean
  /** M2 — `true` si `now ≤ sensorExpiresAt ≤ now + 3j` (préavis). */
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

/**
 * M1 (review re-1 PR #408) — `now` injecté pour cohérence intra-réponse
 * (toutes les rows utilisent le même timestamp de référence).
 *
 * M2 (review re-1 PR #408) — distinction explicite `sensorExpired` vs
 * `sensorExpiringSoon` :
 *   - `sensorExpired`       = `sensorExpiresAt < now`
 *   - `sensorExpiringSoon`  = `now ≤ sensorExpiresAt ≤ now + 3j`
 * Pour le filtre cohort `sensorExpiringSoon=true` (ancien comportement),
 * on inclut les capteurs déjà expirés ET ceux à expirer ≤ 3j (UX
 * "préavis + rappel urgent" unifié) — documenté ci-dessous.
 */
function toDTO(
  d: PatientDevice & { createdAt?: Date | null },
  now: number,
): DeviceSupervisionDTO {
  const expiresMs = d.sensorExpiresAt?.getTime() ?? null
  const sensorExpired = expiresMs !== null && expiresMs < now
  const sensorExpiringSoon = expiresMs !== null
    && expiresMs >= now
    && expiresMs <= now + SUPERVISION_BOUNDS.SENSOR_EXPIRES_SOON_DAYS * 86_400_000
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
    sensorExpired,
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

    // M1 — capture `now` une fois pour cohérence intra-réponse.
    const now = Date.now()
    return rows.map((d) => toDTO(d, now))
  },

  /**
   * Vue cohorte : tous les dispositifs des patients accessibles au
   * caller (via `getAccessiblePatientIds`). ADMIN = pas de restriction.
   *
   * Filtres optionnels :
   *   - `batteryLow=true` → battery_level < BATTERY_LOW_PCT
   *   - `sensorExpiringSoon=true` → sensor_expires_at ≤ now + 3j
   *     **inclut les capteurs déjà expirés** (UX "préavis + rappel
   *     urgent" unifié — la distinction se fait à la lecture via
   *     `sensorExpired` vs `sensorExpiringSoon` du DTO).
   *   - `category=cgm|pump|bgm`
   *
   * Capping : MAX_COHORT_LIMIT=500 (anti-exfil).
   *
   * @perf cohortes ≤ 1000 patients OK (tri/slice in-memory). Pour
   *   > 5000 patients, pousser le tri DB-side via raw query.
   *
   * L3 (review re-1 PR #408) — seuil de scalabilité documenté.
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

    // M4 (review re-1) — `scope` discriminated union pour forensique
    // typée (vs ancien mixed-type `"all"` string vs number).
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
        count: rows.length,
        ...scopeMetadata,
        ...(filters.batteryLow ? { batteryLow: true } : {}),
        ...(filters.sensorExpiringSoon ? { sensorExpiringSoon: true } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        limit,
      },
    })

    const now = Date.now()
    return rows.map((d) => toDTO(d, now))
  },

  /**
   * H1 (review re-1 PR #408) — sync-ping endpoint : alimente
   * `PatientDevice.lastSyncAt` (sinon orphan, US-2244 cohortStatus
   * retournerait 100% never_synced).
   *
   * Mécanique : l'app patient mobile (iOS/Android) appelle ce endpoint
   * périodiquement (ex: après chaque push CGM, ou en heartbeat 5min).
   * Le soignant peut aussi forcer un ping manuel via UI (cas debug).
   *
   * Optionnellement, peut mettre à jour `batteryLevel` et
   * `sensorExpiresAt` (champs ajoutés par cette même migration).
   *
   * RBAC : VIEWER own / NURSE+ cabinet via canAccessPatient.
   * Audit US-2268 pivot patientId + kind `device_supervision.sync_ping`.
   */
  async recordSyncPing(
    patientId: number,
    deviceId: number,
    payload: {
      batteryLevel?: number | null
      sensorExpiresAt?: Date | null
    },
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<DeviceSupervisionDTO> {
    // L1 — validation explicite côté service (defense-in-depth vs Zod
    // route + CHECK constraint DB). Empêche float silently truncated.
    if (payload.batteryLevel != null) {
      if (!Number.isInteger(payload.batteryLevel)
        || payload.batteryLevel < 0 || payload.batteryLevel > 100) {
        throw new DeviceSupervisionValidationError("batteryLevel")
      }
    }

    const device = await prisma.patientDevice.findFirst({
      where: { id: deviceId, patientId },
    })
    if (!device) throw new DeviceSupervisionNotFoundError()

    const allowed = await canAccessPatient(auditUserId, auditUserRole, patientId)
    if (!allowed) throw new DeviceSupervisionAccessError("notPatientCaregiver")

    const updated = await prisma.$transaction(async (tx) => {
      const now = new Date()
      const u = await tx.patientDevice.update({
        where: { id: deviceId },
        data: {
          lastSyncAt: now,
          ...(payload.batteryLevel !== undefined
            ? { batteryLevel: payload.batteryLevel }
            : {}),
          ...(payload.sensorExpiresAt !== undefined
            ? { sensorExpiresAt: payload.sensorExpiresAt }
            : {}),
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "DEVICE",
        resourceId: String(deviceId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          patientId,
          kind: AUDIT_KIND.SYNC_PING,
          ...(payload.batteryLevel !== undefined ? { batteryLevel: payload.batteryLevel } : {}),
          ...(payload.sensorExpiresAt !== undefined
            ? { sensorExpiresAt: payload.sensorExpiresAt?.toISOString() ?? null }
            : {}),
        },
      })
      return u
    })

    return toDTO(updated, Date.now())
  },
}
