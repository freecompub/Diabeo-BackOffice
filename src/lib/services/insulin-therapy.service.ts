/**
 * @module insulin-therapy.service
 * @description Insulin therapy settings CRUD — ISF/ICR/basal configuration by time slots.
 * Supports both pump and multiple daily injection (MDI) delivery methods.
 * All settings validated within clinical bounds before storage.
 * @see CLAUDE.md#insulin-therapy — Configuration domains and validation
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"
import type { BasalConfigType, InsulinDeliveryMethod, Prisma } from "@prisma/client"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import { hasTimeSlotOverlap } from "./time-slot-utils"

/** @deprecated Use CLINICAL_BOUNDS from @/lib/clinical-bounds instead */
export const INSULIN_BOUNDS = CLINICAL_BOUNDS

/**
 * Domain input for upserting a basal configuration.
 * Excludes FK + audit fields owned by the service layer (settingsId, id, createdAt).
 * Using a strict shape instead of Prisma.*UncheckedCreateInput prevents callers
 * from bypassing RBAC or injecting relation IDs.
 */
export interface BasalConfigInput {
  configType: BasalConfigType
  totalDailyDose?: Prisma.Decimal | null
  morningDose?: Prisma.Decimal | null
  eveningDose?: Prisma.Decimal | null
  dailyDose?: Prisma.Decimal | null
}

/**
 * Insulin therapy service — settings, ISF/ICR, basal configuration, bolus logs.
 * @namespace insulinTherapyService
 */
export const insulinTherapyService = {
  /**
   * Get full insulin therapy settings with all relations.
   * Includes active glucose targets, ISF/ICR slots, basal config with pump slots.
   * @async
   * @param {number} patientId - Patient ID
   * @param {number} auditUserId - User performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Object | null>} InsulinTherapySettings with all relations or null
   */
  async getSettings(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const settings = await prisma.insulinTherapySettings.findUnique({
      where: { patientId },
      include: {
        glucoseTargets: { where: { isActive: true } },
        iobSettings: true,
        extendedBolusSettings: true,
        sensitivityFactors: { orderBy: { startHour: "asc" } },
        carbRatios: { orderBy: { startHour: "asc" } },
        basalConfiguration: { include: { pumpSlots: { orderBy: { startTime: "asc" } } } },
      },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "INSULIN_THERAPY",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return settings
  },

  /**
   * Create or update insulin therapy root settings.
   * Sets insulin brands, action duration, delivery method.
   * @async
   * @param {number} patientId - Patient ID
   * @param {Object} input - Settings (bolusInsulinBrand, basalInsulinBrand, insulinActionDuration, deliveryMethod)
   * @param {number} auditUserId - User performing update (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Object>} Updated InsulinTherapySettings
   */
  async upsertSettings(
    patientId: number,
    input: {
      bolusInsulinBrand: string
      basalInsulinBrand?: string
      insulinActionDuration: number
      deliveryMethod: InsulinDeliveryMethod
    },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const settings = await tx.insulinTherapySettings.upsert({
        where: { patientId },
        update: {
          ...input,
          lastModified: new Date(),
        },
        create: { patientId, ...input },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INSULIN_THERAPY",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { updatedFields: Object.keys(input) },
      })

      return settings
    })
  },

  /** Delete all insulin therapy settings (cascade) */
  async deleteSettings(patientId: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      await tx.insulinTherapySettings.delete({ where: { patientId } })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "INSULIN_THERAPY",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return { deleted: true }
    })
  },

  // --- ISF CRUD ---
  async createIsf(
    settingsId: number,
    input: {
      startHour: number; endHour: number
      sensitivityFactorGl: number
    },
    auditUserId: number,
  ) {
    const sensitivityFactorMgdl = input.sensitivityFactorGl * 100
    if (input.startHour === input.endHour) {
      throw new Error("startHour and endHour must be different — a zero-duration slot is invalid")
    }

    return prisma.$transaction(async (tx) => {
      // Check for overlapping ISF slots (HR-2 — clinical safety)
      const existing = await tx.insulinSensitivityFactor.findMany({
        where: { settingsId },
        select: { startHour: true, endHour: true },
      })
      if (hasTimeSlotOverlap(existing, input.startHour, input.endHour)) {
        throw new Error("ISF slot overlaps with an existing slot — risk of incorrect bolus calculation")
      }

      const isf = await tx.insulinSensitivityFactor.create({
        data: {
          settingsId,
          startHour: input.startHour,
          endHour: input.endHour,
          startTime: new Date(`1970-01-01T${String(input.startHour).padStart(2, "0")}:00:00Z`),
          endTime: new Date(`1970-01-01T${String(input.endHour).padStart(2, "0")}:00:00Z`),
          sensitivityFactorGl: input.sensitivityFactorGl,
          sensitivityFactorMgdl,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "INSULIN_THERAPY",
        resourceId: `isf:${isf.id}`,
      })
      return isf
    })
  },

  async deleteIsf(id: string, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      await tx.insulinSensitivityFactor.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "INSULIN_THERAPY",
        resourceId: `isf:${id}`,
      })
      return { deleted: true }
    })
  },

  // --- ICR CRUD ---
  async createIcr(
    settingsId: number,
    input: { startHour: number; endHour: number; gramsPerUnit: number; mealLabel?: string },
    auditUserId: number,
  ) {
    if (input.startHour === input.endHour) {
      throw new Error("startHour and endHour must be different — a zero-duration slot is invalid")
    }

    return prisma.$transaction(async (tx) => {
      // Check for overlapping ICR slots (HR-2 — clinical safety)
      const existing = await tx.carbRatio.findMany({
        where: { settingsId },
        select: { startHour: true, endHour: true },
      })
      if (hasTimeSlotOverlap(existing, input.startHour, input.endHour)) {
        throw new Error("ICR slot overlaps with an existing slot — risk of incorrect bolus calculation")
      }

      const icr = await tx.carbRatio.create({
        data: {
          settingsId,
          startHour: input.startHour,
          endHour: input.endHour,
          startTime: new Date(`1970-01-01T${String(input.startHour).padStart(2, "0")}:00:00Z`),
          endTime: new Date(`1970-01-01T${String(input.endHour).padStart(2, "0")}:00:00Z`),
          gramsPerUnit: input.gramsPerUnit,
          mealLabel: input.mealLabel,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "INSULIN_THERAPY",
        resourceId: `icr:${icr.id}`,
      })
      return icr
    })
  },

  async deleteIcr(id: string, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      await tx.carbRatio.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "INSULIN_THERAPY",
        resourceId: `icr:${id}`,
      })
      return { deleted: true }
    })
  },

  // --- Basal Config ---
  async getBasalConfig(settingsId: number) {
    return prisma.basalConfiguration.findUnique({
      where: { settingsId },
      include: { pumpSlots: { orderBy: { startTime: "asc" } } },
    })
  },

  async upsertBasalConfig(
    settingsId: number,
    input: BasalConfigInput,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const config = await tx.basalConfiguration.upsert({
        where: { settingsId },
        update: input,
        create: { ...input, settingsId },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INSULIN_THERAPY",
        resourceId: `basal:${config.id}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })
      return config
    })
  },

  // --- Pump Basal Slots ---
  async createPumpSlot(
    basalConfigId: number,
    input: { startTime: string; endTime: string; rate: number },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const startHour = parseInt(input.startTime.split(":")[0], 10)
    const endHour = parseInt(input.endTime.split(":")[0], 10)

    if (startHour === endHour && input.startTime === input.endTime) {
      throw new Error("startTime and endTime must be different — a zero-duration slot is invalid")
    }

    return prisma.$transaction(async (tx) => {
      // B2 fix: overlap detection — prevents double basal delivery (patient safety)
      const existing = await tx.pumpBasalSlot.findMany({
        where: { basalConfigId },
        select: { startTime: true, endTime: true },
      })
      const existingHours = existing.map((s) => ({
        startHour: s.startTime.getUTCHours(),
        endHour: s.endTime.getUTCHours(),
      }))
      if (hasTimeSlotOverlap(existingHours, startHour, endHour)) {
        throw new Error("Pump basal slot overlaps with an existing slot — risk of double insulin delivery")
      }

      const slot = await tx.pumpBasalSlot.create({
        data: {
          basalConfigId,
          startTime: new Date(`1970-01-01T${input.startTime}:00Z`),
          endTime: new Date(`1970-01-01T${input.endTime}:00Z`),
          rate: input.rate,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "INSULIN_THERAPY",
        resourceId: `pump:${slot.id}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })
      return slot
    })
  },

  async deletePumpSlot(id: string, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      await tx.pumpBasalSlot.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "INSULIN_THERAPY",
        resourceId: `pump:${id}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })
      return { deleted: true }
    })
  },

  // --- Bolus Logs ---
  async getBolusLogs(
    patientId: number,
    from: Date,
    to: Date,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const logs = await prisma.bolusCalculationLog.findMany({
      where: { patientId, calculatedAt: { gte: from, lte: to } },
      orderBy: { calculatedAt: "desc" },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "BOLUS_LOG",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return logs
  },

  async getBolusLogById(id: string, auditUserId: number) {
    const log = await prisma.bolusCalculationLog.findUnique({ where: { id } })

    if (log) {
      await auditService.log({
        userId: auditUserId,
        action: "READ",
        resource: "BOLUS_LOG",
        resourceId: id,
      })
    }

    return log
  },
}

// hasTimeSlotOverlap, expandHours are in time-slot-utils.ts
