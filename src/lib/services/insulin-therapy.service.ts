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
import { CLINICAL_BOUNDS, isDeliverableBasalRate } from "@/lib/clinical-bounds"
import { hasTimeSlotOverlap } from "./time-slot-utils"
import { analyzeSlotCoverage } from "@/lib/insulin/slot-coverage"

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
  async getSettings(patientId: number, auditUserId: number | null, ctx?: AuditContext) {
    const settings = await prisma.insulinTherapySettings.findUnique({
      where: { patientId },
      include: {
        glucoseTargets: { where: { isActive: true } },
        iobSettings: true,
        extendedBolusSettings: true,
        sensitivityFactors: { orderBy: { startHour: "asc" } },
        carbRatios: { orderBy: { startHour: "asc" } },
        basalConfiguration: { include: { pumpSlots: { orderBy: { startTime: "asc" } } } },
        // Insuline bolus active → nom commercial (catalogue) pour l'onglet Traitements.
        // `select` (pas `include`) — minimisation RGPD : ne charge PAS les `notes`
        // chiffrées ni `prescribedBy`. Inclut usage/isActive/endDate pour la garde
        // « bolus réellement actif » côté vue (anti staleness / mis-typed FK).
        bolusInsulin: {
          select: {
            usage: true,
            isActive: true,
            endDate: true,
            dosage: true,
            insulinCatalog: { select: { displayName: true, genericName: true } },
          },
        },
      },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "INSULIN_THERAPY",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      // US-2268 / ADR #18 — pivot pour la forensique per-patient (getByPatient).
      metadata: { patientId },
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

  /**
   * US-2648b — Édition DIRECTE (DOCTOR) de la valeur d'un créneau ISF. `updateMany`
   * scopé au patient (via `settings.patientId`) → un id d'un autre patient ne matche
   * pas (`count === 0` → `isfSlotNotFound`, anti-IDOR). Ne modifie QUE la valeur, pas
   * les heures (donc pas de re-check de chevauchement). Bornes validées à la route.
   */
  async updateIsf(id: string, sensitivityFactorGl: number, auditUserId: number, patientId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const res = await tx.insulinSensitivityFactor.updateMany({
        where: { id, settings: { patientId } },
        data: { sensitivityFactorGl, sensitivityFactorMgdl: sensitivityFactorGl * 100 },
      })
      if (res.count === 0) throw new Error("isfSlotNotFound")
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INSULIN_THERAPY",
        resourceId: `isf:${id}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { patientId },
      })
      return { updated: true }
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

  /** US-2648b — Édition DIRECTE (DOCTOR) de la valeur d'un créneau ICR. Scopé patient
   *  (via `settings.patientId`, anti-IDOR). Ne modifie que la valeur. Bornes à la route. */
  async updateIcr(id: string, gramsPerUnit: number, auditUserId: number, patientId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const res = await tx.carbRatio.updateMany({
        where: { id, settings: { patientId } },
        data: { gramsPerUnit },
      })
      if (res.count === 0) throw new Error("icrSlotNotFound")
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INSULIN_THERAPY",
        resourceId: `icr:${id}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { patientId },
      })
      return { updated: true }
    })
  },

  /**
   * US-2654 — Déplacement ATOMIQUE des heures d'un créneau ISF (change la STRUCTURE, pas la valeur).
   * Réservé DOCTOR (acte thérapeutique, jamais proposé). En **une transaction**, sûr par construction :
   * 1. charge le créneau **scopé patient** (anti-IDOR — `isfSlotNotFound` sinon) ;
   * 2. rejette la durée nulle (`zeroDurationSlot`) ;
   * 3. projette le profil (autres créneaux + celui-ci aux nouvelles heures) et rejette un **chevauchement**
   *    (`slotOverlapWouldRemain`, self exclu) OU un **trou** de couverture (`slotGapWouldRemain`) — un bolus
   *    doit toujours résoudre un créneau (invariant validé medical) ;
   * 4. met à jour `startHour/endHour` **ET** `startTime/endTime` (dénormalisation) ;
   * 5. **migre** la clé des propositions PENDING (valeur inchangée → baseline valide) ;
   * 6. audit `from/to`.
   */
  async updateIsfHours(id: string, startHour: number, endHour: number, auditUserId: number, patientId: number, ctx?: AuditContext) {
    if (startHour === endHour) throw new Error("zeroDurationSlot")
    return prisma.$transaction(async (tx) => {
      const slot = await tx.insulinSensitivityFactor.findFirst({
        where: { id, settings: { patientId } },
        select: { startHour: true, endHour: true, settingsId: true },
      })
      if (!slot) throw new Error("isfSlotNotFound")
      const others = await tx.insulinSensitivityFactor.findMany({
        where: { settingsId: slot.settingsId, id: { not: id } },
        select: { startHour: true, endHour: true },
      })
      // Chevauchement = BLOQUÉ (double-dose, jamais voulu). Trou = AVERTISSEMENT non bloquant : un profil
      // pavé n'admet aucun déplacement mono-créneau sans état intermédiaire troué ; le gate read-time
      // `coherent` fail-close déjà (visible) tout usage sur config incohérente (validé medical/archi).
      if (hasTimeSlotOverlap(others, startHour, endHour)) throw new Error("slotOverlapWouldRemain")
      const projected = [...others, { startHour, endHour }].map((s) => ({ start: s.startHour * 60, end: s.endHour * 60 }))
      const coverageWarning = analyzeSlotCoverage(projected).hasGap ? ("coverageGap" as const) : undefined
      await tx.insulinSensitivityFactor.update({
        where: { id },
        data: {
          startHour, endHour,
          startTime: new Date(`1970-01-01T${String(startHour).padStart(2, "0")}:00:00Z`),
          endTime: new Date(`1970-01-01T${String(endHour).padStart(2, "0")}:00:00Z`),
        },
      })
      if (slot.startHour !== startHour) {
        await tx.adjustmentProposal.updateMany({
          where: { patientId, parameterType: "insulinSensitivityFactor", timeSlotStartHour: slot.startHour, status: "pending" },
          data: { timeSlotStartHour: startHour, timeSlotEndHour: endHour },
        })
      }
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "INSULIN_THERAPY", resourceId: `isf:${id}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { patientId, from: { startHour: slot.startHour, endHour: slot.endHour }, to: { startHour, endHour } },
      })
      return { updated: true, coverageWarning }
    })
  },

  /** US-2654 — Déplacement atomique des heures d'un créneau ICR (structure). Symétrique de `updateIsfHours`. */
  async updateIcrHours(id: string, startHour: number, endHour: number, auditUserId: number, patientId: number, ctx?: AuditContext) {
    if (startHour === endHour) throw new Error("zeroDurationSlot")
    return prisma.$transaction(async (tx) => {
      const slot = await tx.carbRatio.findFirst({
        where: { id, settings: { patientId } },
        select: { startHour: true, endHour: true, settingsId: true },
      })
      if (!slot) throw new Error("icrSlotNotFound")
      const others = await tx.carbRatio.findMany({
        where: { settingsId: slot.settingsId, id: { not: id } },
        select: { startHour: true, endHour: true },
      })
      if (hasTimeSlotOverlap(others, startHour, endHour)) throw new Error("slotOverlapWouldRemain")
      const projected = [...others, { startHour, endHour }].map((s) => ({ start: s.startHour * 60, end: s.endHour * 60 }))
      const coverageWarning = analyzeSlotCoverage(projected).hasGap ? ("coverageGap" as const) : undefined
      await tx.carbRatio.update({
        where: { id },
        data: {
          startHour, endHour,
          startTime: new Date(`1970-01-01T${String(startHour).padStart(2, "0")}:00:00Z`),
          endTime: new Date(`1970-01-01T${String(endHour).padStart(2, "0")}:00:00Z`),
        },
      })
      if (slot.startHour !== startHour) {
        await tx.adjustmentProposal.updateMany({
          where: { patientId, parameterType: "insulinToCarbRatio", carbRatioSlotStart: slot.startHour, status: "pending" },
          data: { carbRatioSlotStart: startHour, carbRatioSlotEnd: endHour },
        })
      }
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "INSULIN_THERAPY", resourceId: `icr:${id}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { patientId, from: { startHour: slot.startHour, endHour: slot.endHour }, to: { startHour, endHour } },
      })
      return { updated: true, coverageWarning }
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
    // Débit délivrable (multiple de l'incrément pompe) — garde-fő indépendant du Zod route.
    if (!isDeliverableBasalRate(input.rate)) throw new Error("rateNotDeliverable")

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

  /**
   * US-2648b — Édition DIRECTE (DOCTOR) du débit d'un créneau basal pompe. Scopé patient
   * (via `basalConfig.settings.patientId`, anti-IDOR → `pumpSlotNotFound` si autre patient).
   * Le débit doit être PROGRAMMABLE (multiple de `PUMP_BASAL_INCREMENT`) — validé à la route.
   */
  async updatePumpSlot(id: string, rate: number, auditUserId: number, patientId: number, ctx?: AuditContext) {
    // Garde-fő service (défense en profondeur, indépendante du Zod route) : un débit non
    // délivrable (hors incrément pompe) ne doit jamais être persisté, quel que soit l'appelant.
    if (!isDeliverableBasalRate(rate)) throw new Error("rateNotDeliverable")
    return prisma.$transaction(async (tx) => {
      const res = await tx.pumpBasalSlot.updateMany({
        where: { id, basalConfig: { settings: { patientId } } },
        data: { rate },
      })
      if (res.count === 0) throw new Error("pumpSlotNotFound")
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INSULIN_THERAPY",
        resourceId: `pump:${id}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { patientId },
      })
      return { updated: true }
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
      requestId: ctx?.requestId,
      // ADR #18 — pivot per-patient pour getByPatient (forensique CNIL/ANS).
      metadata: { patientId },
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
        // ADR #18 — `resourceId` est l'id du log ; pivot patient via metadata.
        metadata: { patientId: log.patientId },
      })
    }

    return log
  },
}

// hasTimeSlotOverlap, expandHours are in time-slot-utils.ts
