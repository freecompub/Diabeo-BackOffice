/**
 * @module activity.service
 * @description Groupe 6 Batch 1 — Activité physique
 *   - US-2059 : Journal activité (CRUD events `physicalActivity`)
 *   - US-2060 : Apple HealthKit sync (bulk push iOS → backend)
 *   - US-2061 : Google Fit / Health Connect sync (bulk push Android)
 *
 * Réutilise le modèle `DiabetesEvent` existant en filtrant sur
 * `eventTypes has physicalActivity`. Les champs riches (`activityIntensity`,
 * `activitySteps`, `activityDistanceM`, `activityCalories`,
 * `activityHeartRateAvg`, `activitySource`, `externalSyncId`) ont été
 * ajoutés via migration `20260515200000_groupe6_activity_physique`.
 *
 * **Audit US-2268** : `resourceId = event.id`, `metadata.patientId`
 * pivot toujours présent — alimente `auditService.getByPatient(id)`
 * pour la forensique CNIL/ANS.
 */

import { Prisma } from "@prisma/client"
import type {
  ActivityIntensity,
  ActivitySource,
  DiabetesEvent,
  Role,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { canAccessPatient, getOwnPatientId } from "@/lib/access-control"
import { auditService, type AuditContext } from "./audit.service"

// ─────────────────────────────────────────────────────────────
// Audit kinds typés (pattern PR #406 L-NEW-4)
// ─────────────────────────────────────────────────────────────

export type ActivityAuditKind =
  | "activity.create"
  | "activity.update"
  | "activity.delete"
  | "activity.read"
  | "activity.list"
  | "activity.sync"
  | "activity.sync.skipped"

const AUDIT_KIND = {
  CREATE: "activity.create",
  UPDATE: "activity.update",
  DELETE: "activity.delete",
  READ: "activity.read",
  LIST: "activity.list",
  SYNC: "activity.sync",
  SYNC_SKIPPED: "activity.sync.skipped",
} as const satisfies Record<string, ActivityAuditKind>

// ─────────────────────────────────────────────────────────────
// Erreurs typées
// ─────────────────────────────────────────────────────────────

export class ActivityValidationError extends Error {
  constructor(public field: string) {
    super(field)
    this.name = "ActivityValidationError"
  }
}

export class ActivityAccessError extends Error {
  constructor(message = "forbidden") {
    super(message)
    this.name = "ActivityAccessError"
  }
}

export class ActivityNotFoundError extends Error {
  constructor() {
    super("activityNotFound")
    this.name = "ActivityNotFoundError"
  }
}

// ─────────────────────────────────────────────────────────────
// Bornes & types
// ─────────────────────────────────────────────────────────────

/**
 * Bornes cliniques anti-coquille (alignées sur les CHECK constraints DB).
 * Exportées pour partage Zod/service.
 */
export const ACTIVITY_BOUNDS = {
  MAX_DURATION_MIN: 1440, // 24h
  MAX_STEPS: 200_000,
  MAX_DISTANCE_M: 1_000_000, // 1000 km
  MAX_CALORIES: 50_000,
  MIN_HEART_RATE_BPM: 30,
  MAX_HEART_RATE_BPM: 250,
  MAX_COMMENT_LEN: 500,
  MAX_ACTIVITY_TYPE_LEN: 20,
  MAX_EXTERNAL_SYNC_ID_LEN: 128,
  /** Bulk sync — capping anti-flood. */
  MAX_BULK_ITEMS: 500,
} as const

/**
 * Whitelist `activityType` (cohérent avec HealthKit `HKWorkoutActivityType`
 * et Google Fit `FitnessActivity`). Libre côté schema (VARCHAR(20)) mais
 * normalisé au service pour analytics cohérents.
 */
export const ACTIVITY_TYPES = [
  "walk", "run", "bike", "swim", "hike", "yoga",
  "elliptical", "rowing", "strength", "other",
] as const
export type ActivityTypeCode = (typeof ACTIVITY_TYPES)[number]

export interface ActivityInput {
  eventDate: Date
  activityType: ActivityTypeCode
  activityDuration?: number | null // minutes
  activityIntensity?: ActivityIntensity | null
  activitySteps?: number | null
  activityDistanceM?: number | null
  activityCalories?: number | null
  activityHeartRateAvg?: number | null
  comment?: string | null
}

export interface ActivitySyncItem extends ActivityInput {
  /** ID UUID du sample HealthKit / Google Fit pour dédupliquer. */
  externalSyncId: string
}

export interface ActivityDTO {
  id: string
  patientId: number
  eventDate: Date
  activityType: string | null
  activityDuration: number | null
  activityIntensity: ActivityIntensity | null
  activitySteps: number | null
  activityDistanceM: number | null
  activityCalories: number | null
  activityHeartRateAvg: number | null
  activitySource: ActivitySource | null
  externalSyncId: string | null
  comment: string | null
  createdAt: Date
  updatedAt: Date
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function validateActivityInput(input: ActivityInput): void {
  if (!ACTIVITY_TYPES.includes(input.activityType)) {
    throw new ActivityValidationError("activityType")
  }
  if (
    input.activityDuration != null
    && (input.activityDuration < 0 || input.activityDuration > ACTIVITY_BOUNDS.MAX_DURATION_MIN)
  ) {
    throw new ActivityValidationError("activityDuration")
  }
  if (
    input.activitySteps != null
    && (input.activitySteps < 0 || input.activitySteps > ACTIVITY_BOUNDS.MAX_STEPS)
  ) {
    throw new ActivityValidationError("activitySteps")
  }
  if (
    input.activityDistanceM != null
    && (input.activityDistanceM < 0 || input.activityDistanceM > ACTIVITY_BOUNDS.MAX_DISTANCE_M)
  ) {
    throw new ActivityValidationError("activityDistanceM")
  }
  if (
    input.activityCalories != null
    && (input.activityCalories < 0 || input.activityCalories > ACTIVITY_BOUNDS.MAX_CALORIES)
  ) {
    throw new ActivityValidationError("activityCalories")
  }
  if (
    input.activityHeartRateAvg != null
    && (input.activityHeartRateAvg < ACTIVITY_BOUNDS.MIN_HEART_RATE_BPM
      || input.activityHeartRateAvg > ACTIVITY_BOUNDS.MAX_HEART_RATE_BPM)
  ) {
    throw new ActivityValidationError("activityHeartRateAvg")
  }
  if (
    input.comment != null
    && input.comment.length > ACTIVITY_BOUNDS.MAX_COMMENT_LEN
  ) {
    throw new ActivityValidationError("comment")
  }
}

/**
 * VIEWER : doit cibler son propre patient. NURSE/DOCTOR/ADMIN : doit
 * passer `canAccessPatient` (PatientService link ou bypass admin).
 */
async function assertCanWriteActivity(
  patientId: number,
  userId: number,
  role: Role,
): Promise<void> {
  if (role === "VIEWER") {
    const own = await getOwnPatientId(userId)
    if (own !== patientId) throw new ActivityAccessError("notOwnPatient")
    return
  }
  const allowed = await canAccessPatient(userId, role, patientId)
  if (!allowed) throw new ActivityAccessError("notPatientCaregiver")
}

function toDTO(e: DiabetesEvent): ActivityDTO {
  return {
    id: e.id,
    patientId: e.patientId,
    eventDate: e.eventDate,
    activityType: e.activityType,
    activityDuration: e.activityDuration,
    activityIntensity: e.activityIntensity,
    activitySteps: e.activitySteps,
    activityDistanceM: e.activityDistanceM,
    activityCalories: e.activityCalories,
    activityHeartRateAvg: e.activityHeartRateAvg,
    activitySource: e.activitySource,
    externalSyncId: e.externalSyncId,
    comment: e.comment,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const activityService = {
  /**
   * Liste les events `physicalActivity` du patient, optionnellement
   * filtrés par fenêtre temporelle. Audit READ avec pivot patientId.
   */
  async listByPatient(
    patientId: number,
    options: { from?: Date; to?: Date; limit?: number; cursor?: string } = {},
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<ActivityDTO[]> {
    await assertCanWriteActivity(patientId, auditUserId, auditUserRole)

    const limit = Math.min(options.limit ?? 100, 500)
    const rows = await prisma.diabetesEvent.findMany({
      where: {
        patientId,
        eventTypes: { has: "physicalActivity" },
        ...(options.from || options.to
          ? {
            eventDate: {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            },
          }
          : {}),
      },
      orderBy: { eventDate: "desc" },
      take: limit,
      ...(options.cursor ? { skip: 1, cursor: { id: options.cursor } } : {}),
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "ACTIVITY",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        patientId,
        kind: AUDIT_KIND.LIST,
        count: rows.length,
      },
    })

    return rows.map(toDTO)
  },

  /**
   * Crée une entrée `physicalActivity` (déclarative — `activitySource = manual`).
   * Pour les bulk pushes mobiles, utiliser `bulkSync` qui gère la dedup.
   */
  async create(
    patientId: number,
    input: ActivityInput,
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<ActivityDTO> {
    validateActivityInput(input)
    await assertCanWriteActivity(patientId, auditUserId, auditUserRole)

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.diabetesEvent.create({
        data: {
          patientId,
          eventDate: input.eventDate,
          eventTypes: ["physicalActivity"],
          activityType: input.activityType,
          activityDuration: input.activityDuration ?? null,
          activityIntensity: input.activityIntensity ?? null,
          activitySteps: input.activitySteps ?? null,
          activityDistanceM: input.activityDistanceM ?? null,
          activityCalories: input.activityCalories ?? null,
          activityHeartRateAvg: input.activityHeartRateAvg ?? null,
          activitySource: "manual",
          comment: input.comment ?? null,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "ACTIVITY",
        resourceId: created.id,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          patientId,
          kind: AUDIT_KIND.CREATE,
          activityType: input.activityType,
          source: "manual",
        },
      })
      return created
    })

    return toDTO(event)
  },

  /**
   * Met à jour une entrée existante. Les entries `manual` peuvent être
   * modifiées librement par leur propriétaire ou un soignant ; les
   * entries issues d'un capteur (`healthkit`, `google_fit`,
   * `health_connect`) sont **immuables** côté service (defense-in-depth :
   * une mesure capteur ne doit pas être rééditée par un soignant — il
   * faut soft-delete + re-create).
   */
  async update(
    activityId: string,
    input: Partial<ActivityInput>,
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<ActivityDTO> {
    const existing = await prisma.diabetesEvent.findUnique({
      where: { id: activityId },
    })
    if (!existing || !existing.eventTypes.includes("physicalActivity")) {
      throw new ActivityNotFoundError()
    }
    if (existing.activitySource && existing.activitySource !== "manual") {
      throw new ActivityValidationError(`immutableSource:${existing.activitySource}`)
    }
    await assertCanWriteActivity(existing.patientId, auditUserId, auditUserRole)
    if (input.activityType !== undefined) {
      if (!ACTIVITY_TYPES.includes(input.activityType)) {
        throw new ActivityValidationError("activityType")
      }
    }
    // Re-validate scalar bounds for whatever was supplied.
    validateActivityInput({
      activityType: input.activityType ?? (existing.activityType as ActivityTypeCode),
      eventDate: input.eventDate ?? existing.eventDate,
      activityDuration: input.activityDuration ?? existing.activityDuration,
      activityIntensity: input.activityIntensity ?? existing.activityIntensity,
      activitySteps: input.activitySteps ?? existing.activitySteps,
      activityDistanceM: input.activityDistanceM ?? existing.activityDistanceM,
      activityCalories: input.activityCalories ?? existing.activityCalories,
      activityHeartRateAvg: input.activityHeartRateAvg ?? existing.activityHeartRateAvg,
      comment: input.comment ?? existing.comment,
    })

    const data: Prisma.DiabetesEventUpdateInput = {}
    if (input.eventDate !== undefined) data.eventDate = input.eventDate
    if (input.activityType !== undefined) data.activityType = input.activityType
    if (input.activityDuration !== undefined) data.activityDuration = input.activityDuration
    if (input.activityIntensity !== undefined) data.activityIntensity = input.activityIntensity
    if (input.activitySteps !== undefined) data.activitySteps = input.activitySteps
    if (input.activityDistanceM !== undefined) data.activityDistanceM = input.activityDistanceM
    if (input.activityCalories !== undefined) data.activityCalories = input.activityCalories
    if (input.activityHeartRateAvg !== undefined) data.activityHeartRateAvg = input.activityHeartRateAvg
    if (input.comment !== undefined) data.comment = input.comment

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.diabetesEvent.update({
        where: { id: activityId },
        data,
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "ACTIVITY",
        resourceId: activityId,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          patientId: existing.patientId,
          kind: AUDIT_KIND.UPDATE,
          fields: Object.keys(data),
        },
      })
      return u
    })

    return toDTO(updated)
  },

  /**
   * Soft-delete : supprime physiquement la ligne (DiabetesEvent n'a
   * pas de `deletedAt` colonne). RGPD : l'event est rattaché au
   * patient via FK Cascade, donc une suppression patient supprimera
   * tous ses events. Pour le MVP on accepte DELETE physique
   * (cohérent avec eventsService existant).
   */
  async delete(
    activityId: string,
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<void> {
    const existing = await prisma.diabetesEvent.findUnique({
      where: { id: activityId },
    })
    if (!existing || !existing.eventTypes.includes("physicalActivity")) {
      throw new ActivityNotFoundError()
    }
    await assertCanWriteActivity(existing.patientId, auditUserId, auditUserRole)

    await prisma.$transaction(async (tx) => {
      await tx.diabetesEvent.delete({ where: { id: activityId } })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "ACTIVITY",
        resourceId: activityId,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          patientId: existing.patientId,
          kind: AUDIT_KIND.DELETE,
          source: existing.activitySource,
        },
      })
    })
  },

  /**
   * Bulk sync depuis une app mobile (HealthKit / Google Fit / Health Connect).
   *
   * - Chaque item DOIT fournir `externalSyncId` (UUID propre à la source).
   * - La paire `(activitySource, externalSyncId)` est UNIQUE PARTIAL côté DB
   *   (`WHERE external_sync_id IS NOT NULL`) — un re-push du même sample
   *   est silencieusement ignoré (idempotence) sans throw.
   * - VIEWER ne peut sync que son propre patient (cohérent avec l'app
   *   mobile : c'est le patient qui pousse ses données).
   *
   * @returns `{ inserted, skipped }` — nombre de nouvelles entries et
   *          de doublons silencieusement ignorés.
   */
  async bulkSync(
    patientId: number,
    source: Exclude<ActivitySource, "manual">,
    items: ActivitySyncItem[],
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<{ inserted: number; skipped: number }> {
    if (items.length === 0) {
      return { inserted: 0, skipped: 0 }
    }
    if (items.length > ACTIVITY_BOUNDS.MAX_BULK_ITEMS) {
      throw new ActivityValidationError("bulkItemsTooMany")
    }
    await assertCanWriteActivity(patientId, auditUserId, auditUserRole)

    // Validate all items upfront (fail-fast).
    for (const item of items) {
      validateActivityInput(item)
      if (!item.externalSyncId || item.externalSyncId.length > ACTIVITY_BOUNDS.MAX_EXTERNAL_SYNC_ID_LEN) {
        throw new ActivityValidationError("externalSyncId")
      }
    }

    let inserted = 0
    let skipped = 0

    // Process item-by-item dans une transaction unique pour atomicité
    // de l'audit + idempotence (P2002 unique violation → silently skip).
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        try {
          await tx.diabetesEvent.create({
            data: {
              patientId,
              eventDate: item.eventDate,
              eventTypes: ["physicalActivity"],
              activityType: item.activityType,
              activityDuration: item.activityDuration ?? null,
              activityIntensity: item.activityIntensity ?? null,
              activitySteps: item.activitySteps ?? null,
              activityDistanceM: item.activityDistanceM ?? null,
              activityCalories: item.activityCalories ?? null,
              activityHeartRateAvg: item.activityHeartRateAvg ?? null,
              activitySource: source,
              externalSyncId: item.externalSyncId,
              comment: item.comment ?? null,
            },
          })
          inserted++
        } catch (e) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError
            && e.code === "P2002"
          ) {
            skipped++
            continue
          }
          throw e
        }
      }

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "ACTIVITY",
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          patientId,
          kind: AUDIT_KIND.SYNC,
          source,
          inserted,
          skipped,
          totalRequested: items.length,
        },
      })
    })

    return { inserted, skipped }
  },
}
