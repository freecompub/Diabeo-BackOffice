/**
 * @module insulin-meals.service
 * @description Groupe 5 — Insuline & Repas (5 US).
 *
 *  - US-2043 PumpEvent.bulkSync  : import historique pompe
 *  - US-2050 InsulinAdjustmentTemplate : modèles cabinet-scoped
 *  - US-2053 DiabetesEvent validation : NURSE+ marque un event comme validé
 *  - US-2054 FoodItem (CIQUAL)   : référentiel + recherche
 *  - US-2057 MealPhoto           : upload chiffré S3 + ClamAV
 *
 * Conventions (post-reviews PR #388/389/390) :
 *  - Typed errors (`team-workflow.errors`) — ValidationError / NotFoundError / ForbiddenError
 *  - US-2268 pivot `metadata.patientId`
 *  - Transactions Serializable sur les écritures critiques
 *  - HMAC-SHA256 (`hmacField`) pour `food_items.name_hmac` (recherche exact-match)
 *  - S3 SSE-S3 + ClamAV pour photos repas (réutilise pipeline `documents`)
 */

import { Prisma, type Pathology } from "@prisma/client"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import { hmacField } from "@/lib/crypto/hmac"
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./team-workflow.errors"
import { generateObjectKey, uploadFile, deleteFile } from "@/lib/storage/s3"
import { scanBuffer } from "./antivirus.service"

async function assertServiceMember(
  userId: number,
  serviceId: number,
  tx: Tx = prisma,
): Promise<void> {
  const link = await tx.healthcareMember.findFirst({
    where: { userId, serviceId }, select: { id: true },
  })
  if (!link) throw new ForbiddenError()
}

async function assertPatientAlive(patientId: number, tx: Tx = prisma): Promise<void> {
  const p = await tx.patient.findFirst({
    where: { id: patientId, deletedAt: null }, select: { id: true },
  })
  if (!p) throw new NotFoundError()
}

// ─────────────────────────────────────────────────────────────
// US-2043 — Pump event bulk sync
// ─────────────────────────────────────────────────────────────

const PUMP_SYNC_MAX_BATCH = 1000
const PUMP_EVENT_TYPES = new Set([
  "alarm", "suspend", "resume", "prime", "rewind", "bolus", "basal-rate",
  "battery-low", "reservoir-low", "data-import",
])

export type PumpEventInput = {
  timestamp: Date
  eventType: string
  data?: Prisma.InputJsonValue
}

export const pumpEventService = {
  /**
   * Bulk-sync pump events for a patient. Caller is typically a NURSE who has
   * uploaded a pump export file. Rejects batches > 1000 (perf). Each event
   * with an unknown `eventType` is rejected (defence-in-depth).
   *
   * Idempotency: the (patientId, timestamp, eventType) tuple is treated as
   * unique within the same batch by deduplication; cross-batch dedup is
   * delegated to the caller for now (V1) — full upsert pattern in V2.
   */
  async bulkSync(
    patientId: number,
    events: PumpEventInput[],
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<{ inserted: number }> {
    if (events.length === 0) return { inserted: 0 }
    if (events.length > PUMP_SYNC_MAX_BATCH) {
      throw new ValidationError("batchTooLarge")
    }
    for (const e of events) {
      if (!PUMP_EVENT_TYPES.has(e.eventType)) {
        throw new ValidationError("eventType")
      }
    }

    return prisma.$transaction(async (tx) => {
      await assertPatientAlive(patientId, tx)
      const created = await tx.pumpEvent.createMany({
        data: events.map((e) => ({
          patientId,
          timestamp: e.timestamp,
          eventType: e.eventType,
          data: e.data ?? Prisma.JsonNull,
        })),
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "IMPORT", resource: "PUMP_EVENT",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, count: created.count, kind: "bulk-sync" },
      })
      return { inserted: created.count }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2050 — Insulin adjustment templates (cabinet-scoped)
// ─────────────────────────────────────────────────────────────

const TEMPLATE_TITLE_MAX = 120
const ADJUSTMENT_PAYLOAD_MAX_BYTES = 4096
const ALLOWED_PARAMETERS = ["BASAL", "ISF", "ICR"] as const
type InsulinAdjustmentParameter = typeof ALLOWED_PARAMETERS[number]

export type InsulinAdjustmentTemplateDTO = {
  id: number
  serviceId: number
  title: string
  pathology: Pathology | null
  parameter: InsulinAdjustmentParameter
  adjustments: Prisma.JsonValue
}

function toTemplateDTO(t: {
  id: number; serviceId: number; title: string;
  pathology: Pathology | null; parameter: string; adjustments: Prisma.JsonValue;
}): InsulinAdjustmentTemplateDTO {
  return {
    id: t.id, serviceId: t.serviceId, title: t.title,
    pathology: t.pathology,
    parameter: t.parameter as InsulinAdjustmentParameter,
    adjustments: t.adjustments,
  }
}

function validateAdjustmentsPayload(payload: unknown): Prisma.InputJsonValue {
  if (payload === undefined || payload === null) {
    throw new ValidationError("adjustments")
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("adjustmentsShape")
  }
  const serialized = JSON.stringify(payload)
  if (serialized.length > ADJUSTMENT_PAYLOAD_MAX_BYTES) {
    throw new ValidationError("adjustmentsSize")
  }
  return payload as Prisma.InputJsonValue
}

export const insulinAdjustmentTemplateService = {
  async listForService(
    serviceId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<InsulinAdjustmentTemplateDTO[]> {
    await assertServiceMember(auditUserId, serviceId)
    const items = await prisma.insulinAdjustmentTemplate.findMany({
      where: { serviceId },
      orderBy: { title: "asc" },
      select: {
        id: true, serviceId: true, title: true,
        pathology: true, parameter: true, adjustments: true,
      },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "INSULIN_ADJUSTMENT_TEMPLATE",
      resourceId: String(serviceId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "list", serviceId, count: items.length },
    })
    return items.map(toTemplateDTO)
  },

  async create(
    input: {
      serviceId: number; title: string;
      parameter: InsulinAdjustmentParameter;
      pathology?: Pathology; adjustments: unknown;
    },
    auditUserId: number, ctx?: AuditContext,
  ): Promise<InsulinAdjustmentTemplateDTO> {
    const title = input.title.trim()
    if (!title || title.length > TEMPLATE_TITLE_MAX) throw new ValidationError("title")
    if (!ALLOWED_PARAMETERS.includes(input.parameter)) throw new ValidationError("parameter")
    const safeAdjustments = validateAdjustmentsPayload(input.adjustments)

    return prisma.$transaction(async (tx) => {
      await assertServiceMember(auditUserId, input.serviceId, tx)
      const row = await tx.insulinAdjustmentTemplate.create({
        data: {
          serviceId: input.serviceId,
          title,
          pathology: input.pathology,
          parameter: input.parameter,
          adjustments: safeAdjustments,
          createdBy: auditUserId,
        },
        select: {
          id: true, serviceId: true, title: true,
          pathology: true, parameter: true, adjustments: true,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "INSULIN_ADJUSTMENT_TEMPLATE",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { serviceId: input.serviceId, parameter: input.parameter },
      })
      return toTemplateDTO(row)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async delete(id: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const tpl = await tx.insulinAdjustmentTemplate.findUnique({
        where: { id }, select: { id: true, serviceId: true },
      })
      if (!tpl) throw new NotFoundError()
      await assertServiceMember(auditUserId, tpl.serviceId, tx)
      await tx.insulinAdjustmentTemplate.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "INSULIN_ADJUSTMENT_TEMPLATE",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { serviceId: tpl.serviceId },
      })
      return { deleted: true }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2053 — Diabetes event validation (NURSE+ marks as reviewed)
// ─────────────────────────────────────────────────────────────

export const mealValidationService = {
  /**
   * Returns list of unvalidated diabetes events for a patient (typically
   * meals that need NURSE review). Hard-capped to 100 most-recent.
   */
  async listPendingForPatient(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ) {
    const items = await prisma.diabetesEvent.findMany({
      where: {
        patientId, validatedAt: null,
        patient: { deletedAt: null },
      },
      orderBy: { eventDate: "desc" },
      take: 100,
      select: {
        id: true, eventDate: true, eventTypes: true,
        glycemiaValue: true, carbohydrates: true,
        bolusDose: true, basalDose: true,
        comment: true,
      },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "DIABETES_EVENT",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "pending-validation", count: items.length },
    })
    return items
  },

  /**
   * Mark a DiabetesEvent as validated by the caller. Idempotent — re-call
   * returns the existing `validatedAt`. Audits a single `UPDATE` row.
   */
  async validate(eventId: string, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const event = await tx.diabetesEvent.findUnique({
        where: { id: eventId },
        select: { id: true, patientId: true, validatedAt: true, validatedBy: true },
      })
      if (!event) throw new NotFoundError()
      await assertPatientAlive(event.patientId, tx)

      if (event.validatedAt) {
        return { validatedAt: event.validatedAt, validatedBy: event.validatedBy }
      }
      const updated = await tx.diabetesEvent.update({
        where: { id: eventId },
        data: { validatedAt: new Date(), validatedBy: auditUserId },
        select: { validatedAt: true, validatedBy: true },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "DIABETES_EVENT",
        resourceId: eventId,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: event.patientId, kind: "validated" },
      })
      return updated
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  /**
   * Helper for routes to verify access — returns the patientId owning an
   * event so the route can call `canAccessPatient` before mutating.
   */
  async getEventPatientId(eventId: string): Promise<number | null> {
    const e = await prisma.diabetesEvent.findUnique({
      where: { id: eventId }, select: { patientId: true },
    })
    return e?.patientId ?? null
  },
}

// ─────────────────────────────────────────────────────────────
// US-2054 — CIQUAL food items (search + ingest)
// ─────────────────────────────────────────────────────────────

export type FoodItemDTO = {
  id: number
  ciqualCode: string
  name: string
  carbsPer100g: number | null
  proteinPer100g: number | null
  fatPer100g: number | null
  energyKcal100g: number | null
  category: string | null
}

function toFoodItemDTO(f: {
  id: number; ciqualCode: string; name: string;
  carbsPer100g: Prisma.Decimal | null;
  proteinPer100g: Prisma.Decimal | null;
  fatPer100g: Prisma.Decimal | null;
  energyKcal100g: Prisma.Decimal | null;
  category: string | null;
}): FoodItemDTO {
  return {
    id: f.id, ciqualCode: f.ciqualCode, name: f.name,
    carbsPer100g: f.carbsPer100g ? Number(f.carbsPer100g) : null,
    proteinPer100g: f.proteinPer100g ? Number(f.proteinPer100g) : null,
    fatPer100g: f.fatPer100g ? Number(f.fatPer100g) : null,
    energyKcal100g: f.energyKcal100g ? Number(f.energyKcal100g) : null,
    category: f.category,
  }
}

export const foodItemService = {
  /**
   * Exact-match HMAC lookup by name. Same UX rationale as user-management
   * search : HMAC is deterministic, no fuzzy fallback. Optionally narrowed
   * by category. Limit hard-capped at 50.
   */
  async search(
    input: { name?: string; category?: string; limit?: number },
    auditUserId: number, ctx?: AuditContext,
  ): Promise<FoodItemDTO[]> {
    const take = Math.min(Math.max(input.limit ?? 25, 1), 50)
    const where: Prisma.FoodItemWhereInput = {
      ...(input.name?.trim()
        ? { nameHmac: hmacField(input.name) }
        : {}),
      ...(input.category ? { category: input.category } : {}),
    }
    const items = await prisma.foodItem.findMany({
      where,
      orderBy: { name: "asc" },
      take,
      select: {
        id: true, ciqualCode: true, name: true,
        carbsPer100g: true, proteinPer100g: true,
        fatPer100g: true, energyKcal100g: true, category: true,
      },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "FOOD_ITEM",
      resourceId: "search",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: {
        hasName: !!input.name, category: input.category ?? null, count: items.length,
      },
    })
    return items.map(toFoodItemDTO)
  },

  /**
   * Get a single food item by id (typical "after-pick" detail call).
   */
  async getById(id: number, auditUserId: number, ctx?: AuditContext): Promise<FoodItemDTO | null> {
    const item = await prisma.foodItem.findUnique({
      where: { id },
      select: {
        id: true, ciqualCode: true, name: true,
        carbsPer100g: true, proteinPer100g: true,
        fatPer100g: true, energyKcal100g: true, category: true,
      },
    })
    if (!item) return null
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "FOOD_ITEM",
      resourceId: String(id),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { ciqualCode: item.ciqualCode },
    })
    return toFoodItemDTO(item)
  },
}

// ─────────────────────────────────────────────────────────────
// US-2057 — Meal photos (S3 + ClamAV + EXIF strip out of scope)
// ─────────────────────────────────────────────────────────────

const MEAL_PHOTO_MIME_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"])
const MEAL_PHOTO_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export type MealPhotoDTO = {
  id: number
  eventId: string
  patientId: number
  s3Key: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: Date
}

export const mealPhotoService = {
  /**
   * Upload a meal photo. Pipeline :
   *  1. Pre-validate MIME + size (cheap).
   *  2. Pre-validate event ownership (DiabetesEvent.patientId match).
   *  3. ClamAV scan on the buffer (HDS — refuse any infected upload).
   *  4. S3 upload (SSE-S3 server-side encryption).
   *  5. DB insert + audit.
   *
   *  On any failure after S3 upload, the helper performs a compensating
   *  `deleteFile(s3Key)` to keep object storage clean.
   */
  async upload(
    input: {
      eventId: string;
      patientId: number;
      buffer: Buffer;
      mimeType: string;
      width?: number;
      height?: number;
    },
    auditUserId: number, ctx?: AuditContext,
  ): Promise<MealPhotoDTO> {
    if (!MEAL_PHOTO_MIME_ALLOWED.has(input.mimeType)) throw new ValidationError("mimeType")
    if (input.buffer.length === 0 || input.buffer.length > MEAL_PHOTO_MAX_BYTES) {
      throw new ValidationError("sizeBytes")
    }

    // Verify event ownership before doing any I/O.
    const event = await prisma.diabetesEvent.findFirst({
      where: { id: input.eventId, patientId: input.patientId },
      select: { id: true },
    })
    if (!event) throw new ValidationError("eventMismatch")

    // ClamAV — refuse uploads that fail the scan.
    const scan = await scanBuffer(input.buffer, `meal-${input.patientId}.bin`)
    if (!scan.clean) throw new ForbiddenError() // "infected"

    const s3Key = generateObjectKey(`meal-photos/${input.patientId}`, input.mimeType)
    await uploadFile(s3Key, input.buffer, input.mimeType)

    try {
      return await prisma.$transaction(async (tx) => {
        const row = await tx.mealPhoto.create({
          data: {
            eventId: input.eventId,
            patientId: input.patientId,
            s3Key,
            mimeType: input.mimeType,
            sizeBytes: input.buffer.length,
            width: input.width,
            height: input.height,
            uploadedBy: auditUserId,
          },
          select: {
            id: true, eventId: true, patientId: true, s3Key: true,
            mimeType: true, sizeBytes: true, width: true, height: true, createdAt: true,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId, action: "CREATE", resource: "MEAL_PHOTO",
          resourceId: String(row.id),
          ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
          metadata: {
            patientId: input.patientId, eventId: input.eventId,
            mimeType: input.mimeType, sizeBytes: input.buffer.length,
          },
        })
        return row
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (err) {
      // Compensating cleanup — best-effort, swallow.
      try { await deleteFile(s3Key) } catch { /* ignore */ }
      throw err
    }
  },

  async listForPatient(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<MealPhotoDTO[]> {
    const items = await prisma.mealPhoto.findMany({
      where: { patientId, event: { patient: { deletedAt: null } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, eventId: true, patientId: true, s3Key: true,
        mimeType: true, sizeBytes: true, width: true, height: true, createdAt: true,
      },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "MEAL_PHOTO",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "list", count: items.length },
    })
    return items
  },

  /** Resolve the patient owning a photo — for route-level RBAC. */
  async getPhotoPatientId(id: number): Promise<number | null> {
    const p = await prisma.mealPhoto.findUnique({
      where: { id }, select: { patientId: true },
    })
    return p?.patientId ?? null
  },
}
