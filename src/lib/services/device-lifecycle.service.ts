/**
 * @module services/device-lifecycle
 * @description Groupe 4 — Devices & Sync (US-2091 + US-2092 + US-2093).
 *
 * - **US-2091** Compatibilité matérielle : référentiel `SupportedDevice`
 *   (CRUD ADMIN + search NURSE+ pre-pairing UI).
 * - **US-2092** Désactivation/révocation : soft-revoke `PatientDevice`
 *   (revokedAt + revokedBy + revokedReasonEnc chiffré AES-256-GCM).
 *   Idempotent (revoke deux fois = même état). Audit `DEVICE/UPDATE`
 *   kind `device.revoked`.
 * - **US-2093** Historique : list devices d'un patient incluant
 *   révoqués, trié chronologiquement. Audit `DEVICE/READ` kind
 *   `device.history` avec pivot `metadata.patientId` (US-2268).
 *
 * Sécurité HDS :
 *   - `revokedReasonEnc` chiffré AES-256-GCM (peut contenir contexte
 *     clinique PHI).
 *   - RBAC `canAccessPatient` réutilisé (ADMIN/cabinet/owner-VIEWER).
 *   - Anti-énumération : 404 sur device non-trouvé OU patient inaccessible
 *     (pas de distinction).
 */

import { Prisma } from "@prisma/client"
import type { DeviceCategory, Role } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { canAccessPatient } from "@/lib/access-control"
import { logger } from "@/lib/logger"

// ─────────────────────────────────────────────────────────────
// Bornes + types
// ─────────────────────────────────────────────────────────────

export const DEVICE_LIFECYCLE_BOUNDS = {
  /** Max revoked reason length (cohérent avec encrypted column TEXT). */
  MAX_REASON_LEN: 500,
  /** Max history page size (cap forensique pour patient prolifique). */
  MAX_HISTORY_PAGE: 100,
  /** Sensor lifetime cap (jours) — Dexcom G7 10, FreeStyle Libre 14, max 90j cohérent CHECK SQL. */
  MAX_SENSOR_LIFETIME_DAYS: 90,
  /** Max search results SupportedDevice. */
  MAX_SEARCH_RESULTS: 50,
} as const

export type DeviceLifecycleAuditKind =
  | "device.revoked"
  | "device.history"
  | "supported_device.search"
  | "supported_device.created"
  | "device.revoke.accessDenied"
  | "device.history.accessDenied"

const AUDIT_KIND = {
  REVOKED: "device.revoked",
  HISTORY: "device.history",
  SEARCH: "supported_device.search",
  SD_CREATED: "supported_device.created",
  REVOKE_DENIED: "device.revoke.accessDenied",
  HISTORY_DENIED: "device.history.accessDenied",
} as const satisfies Record<string, DeviceLifecycleAuditKind>

export class DeviceLifecycleValidationError extends Error {
  constructor(public field: string, msg: string) {
    super(msg)
    this.name = "DeviceLifecycleValidationError"
  }
}

export class DeviceLifecycleAccessError extends Error {
  constructor(reason = "forbidden") {
    super(reason)
    this.name = "DeviceLifecycleAccessError"
  }
}

export class DeviceLifecycleNotFoundError extends Error {
  constructor(msg = "notFound") {
    super(msg)
    this.name = "DeviceLifecycleNotFoundError"
  }
}

// ─────────────────────────────────────────────────────────────
// RBAC — utilise le helper partagé `canAccessPatient` (CR C1 review).
// Anciennement local, dupliqué avec divergence (ADMIN bypass soft-delete) →
// migré vers `@/lib/access-control` pour respecter l'invariant RGPD :
// ADMIN ne peut pas accéder à un patient soft-deleted.
// ─────────────────────────────────────────────────────────────
// US-2091 — SupportedDevice search/CRUD
// ─────────────────────────────────────────────────────────────

export interface SupportedDeviceDTO {
  id: number
  brand: string
  model: string
  category: DeviceCategory
  modelIdentifier: string | null
  connectionTypes: string[]
  sensorLifetimeDays: number | null
  isHdsCertified: boolean
  notes: string | null
  isActive: boolean
}

export interface SupportedDeviceCreateInput {
  brand: string
  model: string
  category: DeviceCategory
  modelIdentifier?: string
  connectionTypes?: string[]
  sensorLifetimeDays?: number
  isHdsCertified?: boolean
  notes?: string
}

function toSupportedDeviceDTO(
  row: Prisma.SupportedDeviceGetPayload<Record<string, never>>,
): SupportedDeviceDTO {
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    category: row.category,
    modelIdentifier: row.modelIdentifier,
    connectionTypes: row.connectionTypes,
    sensorLifetimeDays: row.sensorLifetimeDays,
    isHdsCertified: row.isHdsCertified,
    notes: row.notes,
    isActive: row.isActive,
  }
}

export const supportedDeviceService = {
  /**
   * Recherche dans le référentiel (pre-pairing UI).
   * Filter optionnels par category + brand. `isActive` filter par défaut.
   */
  async search(
    filter: {
      category?: DeviceCategory
      brand?: string
      includeInactive?: boolean
    },
    auditUserId: number,
    ctx: AuditContext,
  ): Promise<SupportedDeviceDTO[]> {
    const rows = await prisma.supportedDevice.findMany({
      where: {
        ...(filter.category && { category: filter.category }),
        ...(filter.brand && {
          brand: { contains: filter.brand, mode: "insensitive" as const },
        }),
        ...(filter.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      take: DEVICE_LIFECYCLE_BOUNDS.MAX_SEARCH_RESULTS,
    })
    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "SUPPORTED_DEVICE",
      resourceId: "search",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: AUDIT_KIND.SEARCH,
        ...(filter.category && { category: filter.category }),
        resultCount: rows.length,
      },
    })
    return rows.map(toSupportedDeviceDTO)
  },

  /** Vérifie si un device `(brand, model, category)` est supporté. */
  async isSupported(
    brand: string,
    model: string,
    category: DeviceCategory,
  ): Promise<boolean> {
    const row = await prisma.supportedDevice.findUnique({
      where: {
        brand_model_category: { brand, model, category },
      },
      select: { isActive: true },
    })
    return row !== null && row.isActive
  },

  /** ADMIN-only : crée une entrée référentiel. */
  async create(
    input: SupportedDeviceCreateInput,
    auditUserId: number,
    ctx: AuditContext,
  ): Promise<SupportedDeviceDTO> {
    if (!input.brand || input.brand.length > 100) {
      throw new DeviceLifecycleValidationError("brand", "invalid")
    }
    if (!input.model || input.model.length > 100) {
      throw new DeviceLifecycleValidationError("model", "invalid")
    }
    if (input.sensorLifetimeDays !== undefined) {
      if (input.sensorLifetimeDays <= 0
        || input.sensorLifetimeDays > DEVICE_LIFECYCLE_BOUNDS.MAX_SENSOR_LIFETIME_DAYS) {
        throw new DeviceLifecycleValidationError("sensorLifetimeDays", "outOfRange")
      }
    }
    return prisma.$transaction(async (tx) => {
      try {
        const created = await tx.supportedDevice.create({
          data: {
            brand: input.brand,
            model: input.model,
            category: input.category,
            modelIdentifier: input.modelIdentifier ?? null,
            connectionTypes: input.connectionTypes ?? [],
            sensorLifetimeDays: input.sensorLifetimeDays ?? null,
            isHdsCertified: input.isHdsCertified ?? false,
            notes: input.notes ?? null,
            createdBy: auditUserId,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "CREATE",
          resource: "SUPPORTED_DEVICE",
          resourceId: String(created.id),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: {
            kind: AUDIT_KIND.SD_CREATED,
            brand: input.brand,
            model: input.model,
            category: input.category,
          },
        })
        return toSupportedDeviceDTO(created)
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError
          && err.code === "P2002"
        ) {
          throw new DeviceLifecycleValidationError(
            "brand_model_category", "alreadyExists",
          )
        }
        throw err
      }
    })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2092 — Revoke PatientDevice (soft-revoke)
// ─────────────────────────────────────────────────────────────

export interface DeviceHistoryDTO {
  id: number
  patientId: number
  brand: string | null
  model: string | null
  category: DeviceCategory | null
  sn: string | null
  date: Date | null
  isActive: boolean
  revokedAt: Date | null
  revokedBy: number | null
  revokedReason: string | null
  batteryLevel: number | null
  sensorExpiresAt: Date | null
  lastSyncAt: Date | null
}

function toHistoryDTO(
  row: Prisma.PatientDeviceGetPayload<Record<string, never>>,
): DeviceHistoryDTO {
  return {
    id: row.id,
    patientId: row.patientId,
    brand: row.brand,
    model: row.model,
    category: row.category,
    sn: row.sn,
    date: row.date,
    isActive: row.revokedAt === null,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    revokedReason: null, // injecté par toHistoryDTOForRole selon role
    batteryLevel: row.batteryLevel,
    sensorExpiresAt: row.sensorExpiresAt,
    lastSyncAt: row.lastSyncAt,
  }
}

/**
 * CR C2 review — Cross-actor PHI protection. La `revokedReason` peut être
 * écrite par un DOCTOR/NURSE et contenir contexte clinique-only (ex.
 * "suspicion fraude", "décompensation"). VIEWER (patient) ne doit PAS
 * la lire. PS+ peuvent la lire pour forensique.
 *
 * Log warning structuré si decrypt fail (HSA L2 review — distinguer
 * "absence" de "corruption" en logs SOC).
 */
function toHistoryDTOForRole(
  row: Prisma.PatientDeviceGetPayload<Record<string, never>>,
  role: Role,
  callerUserId: number,
): DeviceHistoryDTO {
  const dto = toHistoryDTO(row)
  if (row.revokedReasonEnc !== null && role !== "VIEWER") {
    const decrypted = safeDecryptField(row.revokedReasonEnc)
    if (decrypted === null) {
      // HSA L2 review — alerte SOC si ciphertext non-null mais decrypt fail.
      logger.warn(
        "device-lifecycle",
        "revokedReasonEnc decrypt failed",
        { userId: callerUserId, resource: "DEVICE" },
      )
    }
    dto.revokedReason = decrypted
  }
  return dto
}

/** Émet audit accessDenied US-2265. Fire-and-forget. */
async function emitAccessDenied(
  userId: number,
  patientIdOrDeviceId: number,
  kind: DeviceLifecycleAuditKind,
  ctx: AuditContext,
): Promise<void> {
  try {
    await auditService.accessDenied({
      userId,
      resource: "DEVICE",
      resourceId: String(patientIdOrDeviceId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { kind },
    })
  } catch {
    // swallow — audit fail ne doit pas bloquer la réponse.
  }
}

export const deviceLifecycleService = {
  /**
   * US-2092 — Soft-revoke un device. Idempotent (revoke 2× = no-op).
   *
   * @param patientId Patient propriétaire du device.
   * @param deviceId Device à révoquer.
   * @param reason Raison libre (chiffrée AES-256-GCM avant stockage). PHI possible.
   * @param auditUserId User qui révoque (PS ou patient lui-même).
   */
  async revoke(
    patientId: number,
    deviceId: number,
    reason: string,
    auditUserId: number,
    auditUserRole: Role,
    ctx: AuditContext,
  ): Promise<{ revoked: boolean; alreadyRevoked: boolean }> {
    if (typeof reason !== "string" || reason.length === 0) {
      throw new DeviceLifecycleValidationError("reason", "empty")
    }
    if (reason.length > DEVICE_LIFECYCLE_BOUNDS.MAX_REASON_LEN) {
      throw new DeviceLifecycleValidationError("reason", "tooLong")
    }
    // RBAC.
    const allowed = await canAccessPatient(auditUserId, auditUserRole, patientId)
    if (!allowed) {
      await emitAccessDenied(auditUserId, patientId, AUDIT_KIND.REVOKE_DENIED, ctx)
      throw new DeviceLifecycleAccessError()
    }

    // Fetch device + verify patientId match.
    const device = await prisma.patientDevice.findFirst({
      where: { id: deviceId, patientId },
      select: { id: true, revokedAt: true },
    })
    if (!device) {
      throw new DeviceLifecycleNotFoundError("deviceNotFound")
    }

    // Idempotent : déjà révoqué = no-op + audit info.
    if (device.revokedAt !== null) {
      return { revoked: true, alreadyRevoked: true }
    }

    const now = new Date()
    const reasonEnc = encryptField(reason)

    // CR H1 + HSA H2 review — Atomic CAS + audit DANS la transaction.
    // Si l'audit fail, la révocation est rolled back (cohérence forensique HDS).
    return prisma.$transaction(async (tx) => {
      const result = await tx.patientDevice.updateMany({
        where: { id: deviceId, patientId, revokedAt: null },
        data: {
          revokedAt: now,
          revokedBy: auditUserId,
          revokedReasonEnc: reasonEnc,
        },
      })
      if (result.count === 0) {
        // Race lost — autre thread a déjà révoqué.
        return { revoked: true, alreadyRevoked: true }
      }
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "DEVICE",
        resourceId: String(deviceId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          kind: AUDIT_KIND.REVOKED,
          patientId, // pivot US-2268
        },
      })
      return { revoked: true, alreadyRevoked: false }
    })
  },

  /**
   * US-2093 — Historique complet des devices d'un patient (actifs + révoqués).
   * Tri chronologique inverse (revokedAt si présent, sinon date d'ajout).
   */
  async listHistory(
    patientId: number,
    auditUserId: number,
    auditUserRole: Role,
    ctx: AuditContext,
    opts?: { limit?: number; includeRevoked?: boolean },
  ): Promise<DeviceHistoryDTO[]> {
    // RBAC.
    const allowed = await canAccessPatient(auditUserId, auditUserRole, patientId)
    if (!allowed) {
      await emitAccessDenied(auditUserId, patientId, AUDIT_KIND.HISTORY_DENIED, ctx)
      throw new DeviceLifecycleAccessError()
    }
    const limit = Math.min(
      opts?.limit ?? DEVICE_LIFECYCLE_BOUNDS.MAX_HISTORY_PAGE,
      DEVICE_LIFECYCLE_BOUNDS.MAX_HISTORY_PAGE,
    )
    const includeRevoked = opts?.includeRevoked ?? true

    const rows = await prisma.patientDevice.findMany({
      where: {
        patientId,
        ...(includeRevoked ? {} : { revokedAt: null }),
      },
      // Prisma F-1 + CR M2 review — NULL ordering explicit "nulls: last".
      // Sans ça, PG `DESC` = `NULLS FIRST` → devices actifs (revokedAt NULL)
      // apparaissent en premier au lieu d'en dernier (contraire à intent).
      orderBy: [
        { revokedAt: { sort: "desc", nulls: "last" } },
        { date: { sort: "desc", nulls: "last" } },
        { id: "desc" }, // tie-breaker stable
      ],
      take: limit,
    })

    // Prisma F-4 + L7 review — resourceId = "list" (action non patient-spécifique).
    // patientId reste dans metadata (pivot US-2268) — getByPatient retrouve.
    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "DEVICE",
      resourceId: "list",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: AUDIT_KIND.HISTORY,
        patientId,
        count: rows.length,
        includeRevoked,
      },
    })
    // CR C2 review — toHistoryDTOForRole masque revokedReason si VIEWER.
    return rows.map((r) => toHistoryDTOForRole(r, auditUserRole, auditUserId))
  },
}
