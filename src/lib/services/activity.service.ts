/**
 * @module activity.service
 * @description Groupe 6 Batch 1 — Activité physique
 *   - US-2059 : Journal activité (CRUD events `physicalActivity`)
 *   - US-2060 : Apple HealthKit sync (bulk push iOS → backend)
 *   - US-2061 : Google Fit / Health Connect sync (bulk push Android)
 *
 * Réutilise le modèle `DiabetesEvent` existant en filtrant sur
 * `eventTypes has physicalActivity`. Champs riches ajoutés via
 * migration `20260515200000_groupe6_activity_physique`.
 *
 * **Audit US-2268** : `resourceId = event.id`, `metadata.patientId`
 * pivot toujours présent — alimente `auditService.getByPatient(id)`
 * pour la forensique CNIL/ANS.
 *
 * **Encryption** (C1 review PR #407) : le champ `comment` est chiffré
 * AES-256-GCM (cohérent avec `eventsService` qui partage la même
 * colonne). Encrypt à l'écriture, decrypt au DTO.
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
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
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
 *
 * L3 (review PR #407) — bornes resserrées :
 *   - MAX_STEPS 100_000 (Guinness ~73k/jour)
 *   - MAX_DISTANCE_M 300_000 (300 km/jour ultra-marathon extrême)
 *
 * L4 (review PR #407) — `MAX_EXTERNAL_SYNC_ID_LEN = 128` couvre :
 *   HealthKit UUID (36c), Google Fit `<dataSource>:<startTimeNs>` (~100c),
 *   Health Connect record UUID (36c). Cap conservateur.
 *
 * C3 (review PR #407) — bornes temporelles eventDate :
 *   - Lookback : 2 ans (couvre un re-push initial app fresh-install)
 *   - Future cap : +5 minutes (tolérance clock-skew mobile)
 */
export const ACTIVITY_BOUNDS = {
  MAX_DURATION_MIN: 1440, // 24h
  MAX_STEPS: 100_000,
  MAX_DISTANCE_M: 300_000,
  MAX_CALORIES: 50_000,
  MIN_HEART_RATE_BPM: 30,
  MAX_HEART_RATE_BPM: 250,
  MAX_COMMENT_LEN: 500,
  MAX_ACTIVITY_TYPE_LEN: 20,
  MAX_EXTERNAL_SYNC_ID_LEN: 128,
  MAX_BULK_ITEMS: 500,
  /** C3 — fenêtre acceptée pour `eventDate` (anti-forgery). */
  EVENT_DATE_LOOKBACK_DAYS: 730,
  EVENT_DATE_FUTURE_SKEW_MS: 5 * 60_000,
} as const

/**
 * L2 (review PR #407) — Whitelist `activityType` MVP. L'app mobile
 * doit normaliser HealthKit (80+ types) / Google Fit vers ces 10
 * codes ; les types non-mappés tombent dans `"other"`. Pour preserver
 * la précision clinique sans schema migration, la sync mobile peut
 * passer `comment: "originalType:tennis"` ou metadata enrichie en V2.
 */
export const ACTIVITY_TYPES = [
  "walk", "run", "bike", "swim", "hike", "yoga",
  "elliptical", "rowing", "strength", "other",
] as const
export type ActivityTypeCode = (typeof ACTIVITY_TYPES)[number]

export interface ActivityInput {
  eventDate: Date
  activityType: ActivityTypeCode
  activityDuration?: number | null
  activityIntensity?: ActivityIntensity | null
  activitySteps?: number | null
  activityDistanceM?: number | null
  activityCalories?: number | null
  activityHeartRateAvg?: number | null
  /** Stocké chiffré AES-256-GCM (C1 review PR #407). */
  comment?: string | null
}

export interface ActivitySyncItem extends ActivityInput {
  /** UUID propre à la source mobile (HealthKit / Google Fit / Health Connect). */
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
// Helpers internes
// ─────────────────────────────────────────────────────────────

/**
 * C3 + M9 (review PR #407) — eventDate dans la fenêtre acceptée :
 * `[now − 2y, now + 5min]`. Empêche un VIEWER malveillant de forger
 * une activité antédatée pour falsifier un alibi clinique ou évader
 * la rétention par fenêtre `eventDate >= NOW() - 6 years`.
 */
function assertEventDateInWindow(eventDate: Date): void {
  const now = Date.now()
  const minMs = now - ACTIVITY_BOUNDS.EVENT_DATE_LOOKBACK_DAYS * 86_400_000
  const maxMs = now + ACTIVITY_BOUNDS.EVENT_DATE_FUTURE_SKEW_MS
  const ts = eventDate.getTime()
  if (!Number.isFinite(ts)) {
    throw new ActivityValidationError("eventDate")
  }
  if (ts < minMs) throw new ActivityValidationError("eventDatePast")
  if (ts > maxMs) throw new ActivityValidationError("eventDateFuture")
}

/**
 * M4 (review PR #407) — rejet des control characters dans `comment`
 * (defense-in-depth contre XSS / log injection / unicode tricks).
 * Autorise `\n`, `\t`, `\r` ; rejette le reste de [\x00-\x1F].
 */
function assertCleanComment(comment: string): void {
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(comment)) {
    throw new ActivityValidationError("commentControlChars")
  }
}

function validateActivityInput(input: ActivityInput): void {
  if (!ACTIVITY_TYPES.includes(input.activityType)) {
    throw new ActivityValidationError("activityType")
  }
  // M9 — date validée au service aussi (defense-in-depth si caller non-Zod).
  assertEventDateInWindow(input.eventDate)
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
  if (input.comment != null) {
    if (input.comment.length > ACTIVITY_BOUNDS.MAX_COMMENT_LEN) {
      throw new ActivityValidationError("comment")
    }
    assertCleanComment(input.comment)
  }
}

/**
 * L8 (review PR #407) — Renommé depuis `assertCanWriteActivity` :
 * applique aussi sur les reads (listByPatient). VIEWER : doit cibler
 * son propre patient. NURSE/DOCTOR/ADMIN : doit passer
 * `canAccessPatient` (PatientService link ou bypass admin).
 */
async function assertCanAccessActivity(
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

/**
 * C1 (review PR #407) — Conversion DTO avec déchiffrement `comment`.
 * Le pattern matche `eventsService.toDTO` (cohérence cross-service).
 */
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
    comment: safeDecryptField(e.comment),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const activityService = {
  /** Exporté pour tests / consommateurs avancés. */
  assertCanAccessActivity,

  /**
   * Liste les events `physicalActivity` du patient. H2 (review re-1) :
   * orderBy composite `[eventDate desc, id desc]` pour cursor
   * pagination déterministe même quand plusieurs samples partagent
   * la même seconde (cas typique HealthKit batch).
   */
  async listByPatient(
    patientId: number,
    options: { from?: Date; to?: Date; limit?: number; cursor?: string } = {},
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<ActivityDTO[]> {
    await assertCanAccessActivity(patientId, auditUserId, auditUserRole)

    // H5 (review re-1) — default abaissé à 50 (au lieu de 100), cap 500.
    const limit = Math.min(options.limit ?? 50, 500)
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
      orderBy: [{ eventDate: "desc" }, { id: "desc" }],
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
      // L6 — `resourceId` = patientId natif (canon US-2268), pivot dans metadata.
      resourceId: String(patientId),
      metadata: {
        patientId,
        kind: AUDIT_KIND.LIST,
        count: rows.length,
        limit,
        // H5 — bornes de la fenêtre auditées pour forensique exfil.
        ...(options.from ? { from: options.from.toISOString() } : {}),
        ...(options.to ? { to: options.to.toISOString() } : {}),
      },
    })

    return rows.map(toDTO)
  },

  /**
   * Crée une entrée `physicalActivity` (déclarative — `activitySource = manual`).
   * Pour les bulk pushes mobiles, utiliser `bulkSync` qui gère la dedup.
   *
   * **M5 doc** : `eventDate` peut être passé, mais `createdAt` est figé
   * à `now()` (Prisma @default). Les analytics doivent comparer
   * `createdAt` pour les fenêtres "récent", pas `eventDate`.
   */
  async create(
    patientId: number,
    input: ActivityInput,
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<ActivityDTO> {
    validateActivityInput(input)
    await assertCanAccessActivity(patientId, auditUserId, auditUserRole)

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
          // C1 — chiffrement AES-256-GCM cohérent avec eventsService.
          comment: input.comment != null ? encryptField(input.comment) : null,
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
   * Met à jour une entrée. Sensor entries (`activitySource ≠ manual`)
   * sont immuables : un soignant doit `DELETE` puis re-create manuel.
   * M1 (review re-1) — combiné findUnique + access check en une query
   * via findFirst avec filtres imbriqués.
   */
  async update(
    activityId: string,
    input: Partial<ActivityInput>,
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<ActivityDTO> {
    // Note : on ne peut pas imbriquer le canAccessPatient dans le WHERE
    // Prisma (logique complexe role-dependent). On garde un findUnique
    // puis assertCanAccessActivity pour la sémantique RBAC claire,
    // mais on enchaîne sans transaction inter-query (la transaction
    // englobe seulement l'UPDATE + audit).
    const existing = await prisma.diabetesEvent.findUnique({
      where: { id: activityId },
    })
    if (!existing || !existing.eventTypes.includes("physicalActivity")) {
      throw new ActivityNotFoundError()
    }
    if (existing.activitySource && existing.activitySource !== "manual") {
      throw new ActivityValidationError(`immutableSource:${existing.activitySource}`)
    }
    await assertCanAccessActivity(existing.patientId, auditUserId, auditUserRole)

    if (input.activityType !== undefined) {
      if (!ACTIVITY_TYPES.includes(input.activityType)) {
        throw new ActivityValidationError("activityType")
      }
    }
    // Re-validate full shape (merged with existing) for bound checks.
    const decryptedComment = safeDecryptField(existing.comment)
    validateActivityInput({
      activityType: input.activityType ?? (existing.activityType as ActivityTypeCode),
      eventDate: input.eventDate ?? existing.eventDate,
      activityDuration: input.activityDuration ?? existing.activityDuration,
      activityIntensity: input.activityIntensity ?? existing.activityIntensity,
      activitySteps: input.activitySteps ?? existing.activitySteps,
      activityDistanceM: input.activityDistanceM ?? existing.activityDistanceM,
      activityCalories: input.activityCalories ?? existing.activityCalories,
      activityHeartRateAvg: input.activityHeartRateAvg ?? existing.activityHeartRateAvg,
      comment: input.comment ?? decryptedComment,
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
    if (input.comment !== undefined) {
      // C1 — chiffre la nouvelle valeur ; null efface le champ.
      data.comment = input.comment == null ? null : encryptField(input.comment)
    }

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
   * Soft-delete... no, DELETE physique (cohérent avec eventsService).
   *
   * H3 (review PR #407) — Symétrie immutabilité : un sensor entry
   * (`activitySource ≠ manual`) ne peut pas être DELETE-é par
   * l'application. Évite le bypass DELETE-then-CREATE-modifié.
   * Forensique préservée. L5 follow-up : passer en soft-delete
   * (`deletedAt`) au niveau DiabetesEvent global.
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
    if (existing.activitySource && existing.activitySource !== "manual") {
      throw new ActivityValidationError(`immutableSource:${existing.activitySource}`)
    }
    await assertCanAccessActivity(existing.patientId, auditUserId, auditUserRole)

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
   * H1 (review re-1) — `createMany` avec `skipDuplicates: true` :
   * une seule transaction PG ON CONFLICT DO NOTHING, pas de boucle
   * try/catch P2002. Évite le timeout 5s sur 500 items.
   * H6 (review re-1) — audit row inclut `metadata.insertedIds[]` (UUIDs
   * tirés depuis la BDD post-insert) pour forensique granulaire.
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
    await assertCanAccessActivity(patientId, auditUserId, auditUserRole)

    // Fail-fast : valide tous les items avant tout INSERT.
    for (const item of items) {
      validateActivityInput(item)
      if (!item.externalSyncId || item.externalSyncId.length > ACTIVITY_BOUNDS.MAX_EXTERNAL_SYNC_ID_LEN) {
        throw new ActivityValidationError("externalSyncId")
      }
    }

    const externalIds = items.map((i) => i.externalSyncId)
    const data = items.map((i): Prisma.DiabetesEventCreateManyInput => ({
      patientId,
      eventDate: i.eventDate,
      eventTypes: ["physicalActivity"],
      activityType: i.activityType,
      activityDuration: i.activityDuration ?? null,
      activityIntensity: i.activityIntensity ?? null,
      activitySteps: i.activitySteps ?? null,
      activityDistanceM: i.activityDistanceM ?? null,
      activityCalories: i.activityCalories ?? null,
      activityHeartRateAvg: i.activityHeartRateAvg ?? null,
      activitySource: source,
      externalSyncId: i.externalSyncId,
      // C1 — chiffrement comment dans le bulk aussi.
      comment: i.comment != null ? encryptField(i.comment) : null,
    }))

    // H1 + H6 : single createMany + post-query pour récupérer les UUIDs
    // insérés (audit granulaire). Le timeout transaction est porté à 30s
    // pour les batches MAX_BULK_ITEMS=500 sur infra partagée OVH.
    const result = await prisma.$transaction(
      async (tx) => {
        const created = await tx.diabetesEvent.createMany({
          data,
          skipDuplicates: true,
        })
        // Re-read pour récupérer les IDs (createMany ne les retourne pas).
        const inserted = await tx.diabetesEvent.findMany({
          where: {
            patientId,
            activitySource: source,
            externalSyncId: { in: externalIds },
          },
          select: { id: true, externalSyncId: true },
        })
        const skipped = items.length - created.count
        const insertedIds = inserted.map((r) => r.id)

        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "CREATE",
          resource: "ACTIVITY",
          resourceId: String(patientId),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          metadata: {
            patientId,
            kind: AUDIT_KIND.SYNC,
            source,
            inserted: created.count,
            skipped,
            totalRequested: items.length,
            // H6 — IDs insérés en métadonnées pour forensique granulaire.
            // Limité à MAX_BULK_ITEMS UUIDs = ~18 KB JSONB, bien dans les
            // bornes Postgres (pas d'index sur ce champ).
            insertedIds,
          },
        })

        return { inserted: created.count, skipped }
      },
      { timeout: 30_000, maxWait: 10_000 },
    )

    return result
  },
}
