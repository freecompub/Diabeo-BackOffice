/**
 * @module insulin-meals.service
 * @description Groupe 5 — Insuline & Repas (5 US) + review PR #391 fixes.
 *
 * Sécurité (post-review) :
 *  - C2 : EXIF/GPS strippé par `sharp` avant upload S3 (RGPD Art. 5.1c).
 *  - C3 : event-ownership lookup déplacé DANS la Serializable transaction
 *         (TOCTOU MealPhoto.upload corrigé).
 *  - C4 : `bulkSync` utilise `skipDuplicates: true` + unique index DB
 *         `(patientId, timestamp, eventType)` → idempotence cross-batch.
 *  - H2 : `PumpEvent.data` validé per-event (max 8 KB JSON), batch total ≤ 4 MB.
 *  - H4 : `PUMP_EVENT_TYPES` étendu pour couvrir CareLink/Tandem/Omnipod ;
 *         `data-import` (H9) retiré (system-only).
 *  - H7/H8 : DTOs explicites (`PendingDiabetesEventDTO`, `ValidateResult`) +
 *           `.toNumber()` via `decimalToNumber` (M1).
 *  - M2 : `READ FOOD_ITEM` audit retiré (data publique CIQUAL — bloat).
 *  - M3 : `Buffer.byteLength` (utf8) au lieu de UTF-16 chars.
 *  - M4 : magic-byte sniffing MIME (`file-type` détection in-memory).
 *  - M6 : `mealValidationService.validate` accepte un `accessGuard`
 *         optionnel → service callable directement avec garantie patient-scope.
 *  - M11 : `nameHmac` doc clarifié 1:N.
 *  - L1 : NFC normalization sur recherche FoodItem.
 */

import sharp from "sharp"
import {
  Prisma,
  type Pathology,
} from "@prisma/client"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import { hmacField } from "@/lib/crypto/hmac"
import { decimalToNumber } from "@/lib/db/decimal"
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./team-workflow.errors"
import { generateObjectKey, uploadFile, deleteFile } from "@/lib/storage/s3"
import { scanBuffer } from "./antivirus.service"
import { logger } from "@/lib/logger"

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
// US-2043 — Pump event bulk sync (review C4, H2, H4, H9)
// ─────────────────────────────────────────────────────────────

const PUMP_SYNC_MAX_BATCH = 1000
const PUMP_EVENT_DATA_MAX_BYTES = 8 * 1024
const PUMP_BATCH_DATA_MAX_BYTES = 4 * 1024 * 1024

/**
 * H4 — extended allowlist covering Medtronic CareLink, Tandem t:connect,
 * Insulet Omnipod DASH exports. H9 — `data-import` removed (system-only,
 * was a covert channel risk).
 */
const PUMP_EVENT_TYPES = new Set([
  "alarm", "suspend", "resume", "prime", "rewind",
  "bolus", "basal-rate", "temp-basal", "temp-basal-end",
  "profile-switch", "cartridge-change", "cannula-fill",
  "sensor-change", "bg-check", "meal-marker", "exercise-marker",
  "battery-low", "reservoir-low",
])

export type PumpEventInput = {
  timestamp: Date
  eventType: string
  data?: Prisma.InputJsonValue
}

export const pumpEventService = {
  async bulkSync(
    patientId: number,
    events: PumpEventInput[],
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<{ inserted: number; skipped: number }> {
    if (events.length === 0) return { inserted: 0, skipped: 0 }
    if (events.length > PUMP_SYNC_MAX_BATCH) {
      throw new ValidationError("batchTooLarge")
    }
    let totalDataBytes = 0
    for (const e of events) {
      if (!PUMP_EVENT_TYPES.has(e.eventType)) {
        throw new ValidationError("eventType")
      }
      if (e.data !== undefined) {
        const size = Buffer.byteLength(JSON.stringify(e.data), "utf8")
        if (size > PUMP_EVENT_DATA_MAX_BYTES) {
          throw new ValidationError("eventDataSize")
        }
        totalDataBytes += size
      }
    }
    if (totalDataBytes > PUMP_BATCH_DATA_MAX_BYTES) {
      throw new ValidationError("batchDataSize")
    }

    return prisma.$transaction(async (tx) => {
      await assertPatientAlive(patientId, tx)
      // C4 — skipDuplicates relies on the (patientId, timestamp, eventType)
      // unique index added by migration 20260513230000_groupe5_review_fixes.
      const created = await tx.pumpEvent.createMany({
        data: events.map((e) => ({
          patientId,
          timestamp: e.timestamp,
          eventType: e.eventType,
          data: e.data ?? Prisma.JsonNull,
        })),
        skipDuplicates: true,
      })
      const skipped = events.length - created.count
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "IMPORT", resource: "PUMP_EVENT",
        // Review L2 — resourceId is the bulk sentinel, patientId pivot in metadata.
        resourceId: "bulk",
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, count: created.count, skipped, kind: "bulk-sync" },
      })
      return { inserted: created.count, skipped }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2050 — Insulin adjustment templates (review M3 byte counting)
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

function isAllowedParameter(s: string): s is InsulinAdjustmentParameter {
  return (ALLOWED_PARAMETERS as readonly string[]).includes(s)
}

function toTemplateDTO(t: {
  id: number; serviceId: number; title: string;
  pathology: Pathology | null; parameter: string; adjustments: Prisma.JsonValue;
}): InsulinAdjustmentTemplateDTO {
  // H6 (partial) / M2 — runtime guard on the parameter cast.
  const parameter: InsulinAdjustmentParameter = isAllowedParameter(t.parameter)
    ? t.parameter
    : "BASAL" // defensive fallback ; rows out of the allowlist are stale data
  return {
    id: t.id, serviceId: t.serviceId, title: t.title,
    pathology: t.pathology, parameter,
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
  // M3 — UTF-8 bytes (was UTF-16 char count).
  const serialized = JSON.stringify(payload)
  if (Buffer.byteLength(serialized, "utf8") > ADJUSTMENT_PAYLOAD_MAX_BYTES) {
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
    if (!isAllowedParameter(input.parameter)) throw new ValidationError("parameter")
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
// US-2053 — Diabetes event validation (review H7 DTO, H8 explicit return, M6 access guard)
// ─────────────────────────────────────────────────────────────

export type PendingDiabetesEventDTO = {
  id: string
  eventDate: Date
  eventTypes: string[]
  glycemiaValue: number | null
  carbohydrates: number | null
  bolusDose: number | null
  basalDose: number | null
  comment: string | null
}

export type ValidateResult = {
  validatedAt: Date
  validatedBy: number | null
}

type AccessGuard = (patientId: number) => Promise<boolean>

export const mealValidationService = {
  async listPendingForPatient(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<PendingDiabetesEventDTO[]> {
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
    // H7 — DTO with .toNumber() on Decimal fields (no string serialisation).
    return items.map((e) => ({
      id: e.id,
      eventDate: e.eventDate,
      eventTypes: e.eventTypes,
      glycemiaValue: e.glycemiaValue !== null ? decimalToNumber(e.glycemiaValue) : null,
      carbohydrates: e.carbohydrates !== null ? decimalToNumber(e.carbohydrates) : null,
      bolusDose:     e.bolusDose     !== null ? decimalToNumber(e.bolusDose)     : null,
      basalDose:     e.basalDose     !== null ? decimalToNumber(e.basalDose)     : null,
      comment: e.comment,
    }))
  },

  /**
   * Validate a diabetes event. Optionally pass `accessGuard` to enforce
   * patient-scope at the service boundary (M6 — protects against
   * non-route callers like cron / background workers).
   */
  async validate(
    eventId: string,
    auditUserId: number,
    ctx?: AuditContext,
    accessGuard?: AccessGuard,
  ): Promise<ValidateResult> {
    return prisma.$transaction(async (tx) => {
      const event = await tx.diabetesEvent.findUnique({
        where: { id: eventId },
        select: { id: true, patientId: true, validatedAt: true, validatedBy: true },
      })
      if (!event) throw new NotFoundError()
      await assertPatientAlive(event.patientId, tx)

      if (accessGuard && !(await accessGuard(event.patientId))) {
        throw new ForbiddenError()
      }

      // H8 — explicit return type guarantees `validatedAt: Date` post-call.
      if (event.validatedAt) {
        return { validatedAt: event.validatedAt, validatedBy: event.validatedBy }
      }
      const now = new Date()
      await tx.diabetesEvent.update({
        where: { id: eventId },
        data: { validatedAt: now, validatedBy: auditUserId },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "DIABETES_EVENT",
        resourceId: eventId,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: event.patientId, kind: "validated" },
      })
      return { validatedAt: now, validatedBy: auditUserId }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async getEventPatientId(eventId: string): Promise<number | null> {
    const e = await prisma.diabetesEvent.findUnique({
      where: { id: eventId }, select: { patientId: true },
    })
    return e?.patientId ?? null
  },
}

// ─────────────────────────────────────────────────────────────
// US-2054 — CIQUAL food items (review M1 decimalToNumber, M2 drop audit, L1 NFC)
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
    carbsPer100g:   f.carbsPer100g   !== null ? decimalToNumber(f.carbsPer100g)   : null,
    proteinPer100g: f.proteinPer100g !== null ? decimalToNumber(f.proteinPer100g) : null,
    fatPer100g:     f.fatPer100g     !== null ? decimalToNumber(f.fatPer100g)     : null,
    energyKcal100g: f.energyKcal100g !== null ? decimalToNumber(f.energyKcal100g) : null,
    category: f.category,
  }
}

export const foodItemService = {
  /**
   * Exact-match HMAC lookup by name (1:N — CIQUAL allows homonyms across
   * categories e.g. "Pomme"). L1 — name normalized to NFC before HMAC so
   * client-side decomposed/composed encodings match.
   */
  async search(
    input: { name?: string; category?: string; limit?: number },
  ): Promise<FoodItemDTO[]> {
    const take = Math.min(Math.max(input.limit ?? 25, 1), 50)
    const where: Prisma.FoodItemWhereInput = {
      ...(input.name?.trim()
        ? { nameHmac: hmacField(input.name.normalize("NFC")) }
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
    // M2 — no audit for public CIQUAL data (was bloating audit_logs).
    return items.map(toFoodItemDTO)
  },

  async getById(id: number): Promise<FoodItemDTO | null> {
    const item = await prisma.foodItem.findUnique({
      where: { id },
      select: {
        id: true, ciqualCode: true, name: true,
        carbsPer100g: true, proteinPer100g: true,
        fatPer100g: true, energyKcal100g: true, category: true,
      },
    })
    return item ? toFoodItemDTO(item) : null
  },
}

// ─────────────────────────────────────────────────────────────
// US-2057 — Meal photos (review C2 EXIF strip, C3 TOCTOU, M4 magic-byte, M13 hide s3Key)
// ─────────────────────────────────────────────────────────────

const MEAL_PHOTO_MIME_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"])
const MEAL_PHOTO_MAX_BYTES = 5 * 1024 * 1024

/** Public DTO — no s3Key (review M13). */
export type MealPhotoPublicDTO = {
  id: number
  eventId: string
  patientId: number
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: Date
}

/**
 * M4 — magic-byte sniffing on the image header. Returns the actual MIME
 * type if recognised. Rejects everything else. Implemented in-line to
 * avoid adding `file-type` dep just for 3 formats.
 */
function detectImageMime(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length < 12) return null
  // JPEG : FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "image/png"
  // WebP : RIFF .... WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp"
  return null
}

/**
 * C2 — re-encode the image with `sharp` to strip ALL metadata (EXIF, XMP,
 * IPTC). `.rotate()` first to bake the EXIF orientation into pixel layout
 * BEFORE `withMetadata({})` drops the tag — otherwise upside-down photos
 * land on S3.
 */
async function stripImageMetadata(
  buf: Buffer, mime: string,
): Promise<{ buffer: Buffer; width: number | null; height: number | null }> {
  let pipeline = sharp(buf, { failOn: "error" }).rotate()
  if (mime === "image/jpeg") pipeline = pipeline.jpeg({ mozjpeg: true })
  else if (mime === "image/png") pipeline = pipeline.png()
  else if (mime === "image/webp") pipeline = pipeline.webp()
  // withMetadata({}) → drop all (no EXIF, no orientation tag since we already rotated).
  const stripped = await pipeline.withMetadata({}).toBuffer({ resolveWithObject: true })
  return {
    buffer: stripped.data,
    width: stripped.info.width ?? null,
    height: stripped.info.height ?? null,
  }
}

export const mealPhotoService = {
  async upload(
    input: {
      eventId: string;
      patientId: number;
      buffer: Buffer;
      mimeType: string;
    },
    auditUserId: number, ctx?: AuditContext,
  ): Promise<MealPhotoPublicDTO> {
    if (!MEAL_PHOTO_MIME_ALLOWED.has(input.mimeType)) throw new ValidationError("mimeType")
    if (input.buffer.length === 0 || input.buffer.length > MEAL_PHOTO_MAX_BYTES) {
      throw new ValidationError("sizeBytes")
    }
    // M4 — magic-byte must match the declared MIME.
    const sniffed = detectImageMime(input.buffer)
    if (!sniffed || sniffed !== input.mimeType) {
      throw new ValidationError("mimeMismatch")
    }

    // ClamAV — refuse infected uploads. Production fail-closed (cf. antivirus.service).
    const scan = await scanBuffer(input.buffer, `meal-${input.patientId}.bin`)
    if (!scan.clean) throw new ForbiddenError()

    // C2 — strip EXIF/XMP/IPTC before S3 upload (RGPD Art. 5.1c).
    let strippedBuf: Buffer
    let dimW: number | null
    let dimH: number | null
    try {
      const out = await stripImageMetadata(input.buffer, input.mimeType)
      strippedBuf = out.buffer
      dimW = out.width
      dimH = out.height
    } catch (err) {
      logger.error("meal-photo", "metadata strip failed", {}, err)
      throw new ValidationError("imageCorrupt")
    }

    const s3Key = generateObjectKey(`meal-photos/${input.patientId}`, input.mimeType)
    await uploadFile(s3Key, strippedBuf, input.mimeType)

    try {
      return await prisma.$transaction(async (tx) => {
        // C3 — event-ownership re-checked INSIDE the Serializable transaction.
        // Eliminates the TOCTOU window between the pre-upload check and the
        // INSERT.
        const event = await tx.diabetesEvent.findFirst({
          where: {
            id: input.eventId,
            patientId: input.patientId,
            patient: { deletedAt: null },
          },
          select: { id: true },
        })
        if (!event) throw new ValidationError("eventMismatch")

        const row = await tx.mealPhoto.create({
          data: {
            eventId: input.eventId,
            patientId: input.patientId,
            s3Key,
            mimeType: input.mimeType,
            sizeBytes: strippedBuf.length,
            width: dimW,
            height: dimH,
            uploadedBy: auditUserId,
          },
          select: {
            id: true, eventId: true, patientId: true,
            mimeType: true, sizeBytes: true, width: true, height: true, createdAt: true,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId, action: "CREATE", resource: "MEAL_PHOTO",
          resourceId: String(row.id),
          ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
          metadata: {
            patientId: input.patientId, eventId: input.eventId,
            mimeType: input.mimeType, sizeBytes: strippedBuf.length,
            stripped: true,
          },
        })
        return row
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (err) {
      // M7 — compensating cleanup with observability.
      try {
        await deleteFile(s3Key)
      } catch (cleanupErr) {
        logger.error("meal-photo", "S3 compensating cleanup failed", {}, cleanupErr)
        try {
          await auditService.log({
            userId: auditUserId, action: "DELETE", resource: "MEAL_PHOTO",
            resourceId: s3Key,
            ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
            metadata: { patientId: input.patientId, kind: "cleanup-failed" },
          })
        } catch { /* swallow */ }
      }
      throw err
    }
  },

  async listForPatient(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<MealPhotoPublicDTO[]> {
    const items = await prisma.mealPhoto.findMany({
      where: { patientId, event: { patient: { deletedAt: null } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      // M13 — do NOT select s3Key (internal-only, returned only via signed-URL flow).
      select: {
        id: true, eventId: true, patientId: true,
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

  async getPhotoPatientId(id: number): Promise<number | null> {
    const p = await prisma.mealPhoto.findUnique({
      where: { id }, select: { patientId: true },
    })
    return p?.patientId ?? null
  },
}
