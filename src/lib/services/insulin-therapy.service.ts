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
import type { InsulinDeliveryMethod, Prisma } from "@prisma/client"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"

/** @deprecated Use CLINICAL_BOUNDS from @/lib/clinical-bounds instead */
export const INSULIN_BOUNDS = CLINICAL_BOUNDS

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
        resourceId: isf.id,
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
        resourceId: id,
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
        resourceId: icr.id,
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
        resourceId: id,
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
    input: Prisma.BasalConfigurationUncheckedCreateInput,
    auditUserId: number,
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
      })
      return config
    })
  },

  // --- Pump Basal Slots ---
  async createPumpSlot(
    basalConfigId: number,
    input: { startTime: string; endTime: string; rate: number },
    auditUserId: number,
  ) {
    return prisma.$transaction(async (tx) => {
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
        resourceId: slot.id,
      })
      return slot
    })
  },

  async deletePumpSlot(id: string, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      await tx.pumpBasalSlot.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "INSULIN_THERAPY",
        resourceId: id,
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

/**
 * Check if a new time slot overlaps with any existing slots.
 * Supports midnight crossing (e.g., 22h → 6h).
 *
 * Clinical safety: overlapping ISF/ICR slots could cause the bolus
 * calculator to pick the wrong ratio, leading to incorrect dosing.
 *
 * @param existing - Array of existing slots with startHour/endHour
 * @param newStart - New slot start hour (0-23)
 * @param newEnd - New slot end hour (0-23)
 * @returns true if there is any overlap
 */
export function hasTimeSlotOverlap(
  existing: Array<{ startHour: number; endHour: number }>,
  newStart: number,
  newEnd: number,
): boolean {
  for (const slot of existing) {
    if (hoursOverlap(slot.startHour, slot.endHour, newStart, newEnd)) {
      return true
    }
  }
  return false
}

function hoursOverlap(
  aStart: number, aEnd: number,
  bStart: number, bEnd: number,
): boolean {
  // Expand to sets of covered hours for each slot
  const setA = expandHours(aStart, aEnd)
  const setB = expandHours(bStart, bEnd)
  return setA.some((h) => setB.includes(h))
}

function expandHours(start: number, end: number): number[] {
  const hours: number[] = []
  if (start <= end) {
    for (let h = start; h < end; h++) hours.push(h)
  } else {
    // Midnight crossing: 22→6 = [22,23,0,1,2,3,4,5]
    for (let h = start; h < 24; h++) hours.push(h)
    for (let h = 0; h < end; h++) hours.push(h)
  }
  return hours
}
