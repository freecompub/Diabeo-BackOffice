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
  /** Max revoked reason length en CHARS UTF-8 (cohérent avec VARCHAR(2816) DB). */
  MAX_REASON_LEN: 500,
  /**
   * M1 round 2 review — Max revoked reason length en BYTES UTF-8.
   * 500 chars × 4 bytes max (emojis, arabe US-2112) = 2000 bytes plaintext.
   * Cap byte-length applicatif = 500 bytes (Zod `refine`) pour cohérence
   * avec l'esprit de la borne "500 chars" alors que l'utilisateur restera
   * presque toujours sub-byte (ASCII français standard).
   */
  MAX_REASON_BYTES: 500,
  /** Max history page size (cap forensique pour patient prolifique). */
  MAX_HISTORY_PAGE: 100,
  /** Sensor lifetime cap (jours) — Dexcom G7 10, FreeStyle Libre 14, max 90j cohérent CHECK SQL. */
  MAX_SENSOR_LIFETIME_DAYS: 90,
  /** Max search results SupportedDevice. */
  MAX_SEARCH_RESULTS: 50,
} as const

// CR L7 review — resourceId const pour search référentiel
// (sentinel "all" ≠ entité spécifique, requête transversale).
const SEARCH_RESOURCE_ID = "all"
const LIST_RESOURCE_ID = "list"

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
      resourceId: SEARCH_RESOURCE_ID,
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
      // L2 round 2 review — ajout `deviceId` + `patientId` pour forensique
      // ciblée (SOC peut investiguer la row directement vs grep aveugle).
      logger.warn(
        "device-lifecycle",
        "revokedReasonEnc decrypt failed",
        {
          userId: callerUserId,
          resource: "DEVICE",
          deviceId: row.id,
          patientId: row.patientId,
        },
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
    // M1 round 2 review — byte-length defense-in-depth.
    // String.length compte les chars Unicode (code points). UTF-8 multi-
    // octets (arabe, emojis) → byte size > char count. Sans cette borne,
    // un payload 500 chars arabe = 1000-2000 bytes ciphertext → potentiellement
    // tronqué silencieusement par VARCHAR(2816) (= 2704 chars max base64).
    if (Buffer.byteLength(reason, "utf8") > DEVICE_LIFECYCLE_BOUNDS.MAX_REASON_BYTES) {
      throw new DeviceLifecycleValidationError("reason", "tooLongBytes")
    }
    // RBAC.
    const allowed = await canAccessPatient(auditUserId, auditUserRole, patientId)
    if (!allowed) {
      await emitAccessDenied(auditUserId, patientId, AUDIT_KIND.REVOKE_DENIED, ctx)
      throw new DeviceLifecycleAccessError()
    }

    // Fetch device + verify patientId match.
    // CR L3 review — brand/model pour audit metadata (forensique sans
    // déchiffrement, traçabilité fournisseur).
    const device = await prisma.patientDevice.findFirst({
      where: { id: deviceId, patientId },
      select: { id: true, revokedAt: true, brand: true, model: true },
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
          // CR L3 — brand/model pour traçabilité fournisseur sans décrypter.
          ...(device.brand && { brand: device.brand }),
          ...(device.model && { model: device.model }),
        },
      })
      return { revoked: true, alreadyRevoked: false }
    })
  },

  /**
   * US-2093 — Historique complet des devices d'un patient (actifs + révoqués).
   * Tri chronologique inverse strict sur `createdAt` (le plus récent en premier).
   *
   * HSA L1 + Prisma F-1 review round 2 — Cursor pagination keyset valide :
   * Prisma traduit `cursor: {id}` en `WHERE id < $cursorId` qui n'est SÉMANTI-
   * QUEMENT correct que si `id` est le premier critère de tri (ou tie-breaker
   * unique avec orderBy mono-colonne). Avec un compound orderBy `[revokedAt,
   * createdAt, id]`, le cursor peut sauter ou dupliquer des lignes entre pages
   * — casse forensique HDS Art. L.1111-8.
   *
   * Solution : tri unique `(createdAt DESC, id DESC)` — `createdAt` étant
   * immutable (HSA M1) + `id` tie-breaker unique = keyset valide. Le tri
   * "révoqués en premier" est abandonné pour préserver l'intégrité de la
   * pagination ; le caller peut séparer client-side via `isActive` du DTO.
   */
  async listHistory(
    patientId: number,
    auditUserId: number,
    auditUserRole: Role,
    ctx: AuditContext,
    opts?: { limit?: number; includeRevoked?: boolean; cursorId?: number },
  ): Promise<{ items: DeviceHistoryDTO[]; nextCursor: number | null }> {
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
      // Tri chronologique unique — cursor-safe (cf. doc ci-dessus).
      orderBy: [
        { createdAt: "desc" as const },
        { id: "desc" as const }, // tie-breaker stable
      ],
      // HSA L1 — cursor pagination keyset (perf O(log n) via index
      // patient_devices_patient_created_idx).
      ...(opts?.cursorId && {
        cursor: { id: opts.cursorId },
        skip: 1,
      }),
      take: limit + 1, // +1 pour détecter `hasMore`.
    })

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? items[items.length - 1].id : null

    // Prisma F-4 + L7 review — resourceId = "list" (action non patient-spécifique).
    // patientId reste dans metadata (pivot US-2268) — getByPatient retrouve.
    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "DEVICE",
      resourceId: LIST_RESOURCE_ID,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: AUDIT_KIND.HISTORY,
        patientId,
        count: items.length,
        includeRevoked,
        ...(opts?.cursorId && { cursor: opts.cursorId }),
      },
    })
    // CR C2 review — toHistoryDTOForRole masque revokedReason si VIEWER.
    return {
      items: items.map((r) => toHistoryDTOForRole(r, auditUserRole, auditUserId)),
      nextCursor,
    }
  },
}
