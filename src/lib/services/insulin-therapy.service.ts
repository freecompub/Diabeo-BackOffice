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
/**
 * US-2655 — Fin commune du remplacement de groupe (ISF/ICR), dans la transaction :
 * supersède les propositions `pending` du paramètre (baseline changé → libère `one_pending_per_slot`)
 * puis journalise l'audit `replaceSet` (`from → to`, sans PHI). Retourne le résumé.
 */
async function finishReplaceSet(
  tx: Prisma.TransactionClient,
  param: "isf" | "icr",
  parameterType: "insulinSensitivityFactor" | "insulinToCarbRatio",
  patientId: number,
  settingsId: number,
  before: Array<{ startHour: number; endHour: number }>,
  slots: Array<{ startHour: number; endHour: number }>,
  auditUserId: number,
  coverage: { hasGap: boolean; hasOverlap: boolean },
  ctx?: AuditContext,
): Promise<{
  applied: true
  count: number
  coverage: { hasGap: boolean; hasOverlap: boolean }
  supersededProposalIds: string[]
}> {
  const superseded = await tx.adjustmentProposal.findMany({
    where: { patientId, parameterType, status: "pending" },
    select: { id: true },
  })
  if (superseded.length > 0) {
    await tx.adjustmentProposal.updateMany({
      where: { patientId, parameterType, status: "pending" },
      data: { status: "superseded", reviewedAt: new Date(), reviewedBy: auditUserId },
    })
  }
  const supersededProposalIds = superseded.map((p) => p.id)

  await auditService.logWithTx(tx, {
    userId: auditUserId,
    action: "UPDATE",
    resource: "INSULIN_THERAPY",
    resourceId: `${param}-set:${settingsId}`,
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
    metadata: {
      patientId,
      op: "replaceSet",
      from: before.map((s) => ({ startHour: s.startHour, endHour: s.endHour })),
      to: slots.map((s) => ({ startHour: s.startHour, endHour: s.endHour })),
      supersededProposalIds,
    },
  })

  return { applied: true as const, count: slots.length, coverage, supersededProposalIds }
}

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

  /**
   * US-2655 — Suppression d'un créneau ISF **scopée patient** (anti-IDOR). `deleteMany` sur
   * `{ id, settings: { patientId } }` : un id d'un autre patient ne matche pas (`count === 0`
   * → `isfSlotNotFound`), à l'image du pattern anti-IDOR de `updateIsf`.
   */
  async deleteIsf(id: string, auditUserId: number, patientId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const res = await tx.insulinSensitivityFactor.deleteMany({ where: { id, settings: { patientId } } })
      if (res.count === 0) throw new Error("isfSlotNotFound")
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "INSULIN_THERAPY",
        resourceId: `isf:${id}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { patientId },
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

  /** US-2655 — Suppression d'un créneau ICR **scopée patient** (anti-IDOR). Symétrique de `deleteIsf`. */
  async deleteIcr(id: string, auditUserId: number, patientId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const res = await tx.carbRatio.deleteMany({ where: { id, settings: { patientId } } })
      if (res.count === 0) throw new Error("icrSlotNotFound")
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "INSULIN_THERAPY",
        resourceId: `icr:${id}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { patientId },
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
   * US-2655 — Enregistrement transactionnel d'un GROUPE de créneaux (« remplace tout le jeu »).
   *
   * Le client envoie le **jeu complet** désiré pour un paramètre (`isf` ou `icr`) ; le serveur le
   * valide sur l'état **final**, puis remplace atomiquement. Fin de l'édition ligne-à-ligne (qui
   * traversait des états incohérents transitoires).
   *
   * **Invariants (re-validés serveur — jamais confiance au client)** :
   * - **Chevauchement** → rejet dur `slotOverlap` (risque de double-dose).
   * - **Trou de couverture 24 h** (ISF/ICR) → rejet `slotGap` — un bolus doit toujours résoudre un créneau.
   *   (Applicable ici car on valide le jeu FINAL complet, pas un déplacement mono-créneau transitoire.)
   * - **Durée nulle** (`startHour === endHour`) → `zeroDurationSlot` ; **jeu vide** → `emptySlotSet`.
   * - Convention d'encodage : `endHour ∈ [0,23]`, un profil complet enjambe minuit via un créneau
   *   `startHour > endHour` (ex. `[22,6)`), géré par `analyzeSlotCoverage`. Pas de `endHour = 24`.
   *
   * **Anti-IDOR** : scopé `settings.patientId` ; le body ne porte jamais d'`id` de ligne.
   * **Dénormalisation** : `startHour/endHour` **et** `startTime/endTime` écrits ensemble.
   * **Propositions** : les `pending` du même `parameterType` pour ce patient sont **supersédées**
   * (le baseline a changé) — libère l'index `one_pending_per_slot`, pas de collision P2002.
   *
   * Réservé au chemin **DOCTOR direct** (application immédiate). Le chemin proposition (NURSE/patient)
   * est ouvert par US-2657 ; ici la garde `proposalAlreadyPending` n'est pas encore branchée.
   *
   * @param param - `"isf"` ou `"icr"`.
   * @param patientId - patient scopé (résolu serveur, anti-IDOR).
   * @param slots - jeu complet `{ startHour, endHour, value, mealLabel? }` (value = ISF g/L ou ICR g/U).
   * @throws emptySlotSet | zeroDurationSlot | slotOverlap | slotGap | settingsNotFound
   */
  async replaceSlotSet(
    param: "isf" | "icr",
    patientId: number,
    slots: Array<{ startHour: number; endHour: number; value: number; mealLabel?: string }>,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<{
    applied: true
    count: number
    coverage: { hasGap: boolean; hasOverlap: boolean }
    supersededProposalIds: string[]
  }> {
    // 1. Pré-validation pure (hors DB, fail-fast) sur l'état FINAL.
    if (slots.length === 0) throw new Error("emptySlotSet")
    for (const s of slots) {
      if (s.startHour === s.endHour) throw new Error("zeroDurationSlot")
    }
    const coverage = analyzeSlotCoverage(slots.map((s) => ({ start: s.startHour * 60, end: s.endHour * 60 })))
    if (coverage.hasOverlap) throw new Error("slotOverlap")
    if (coverage.hasGap) throw new Error("slotGap") // ISF/ICR : no-gap strict (le bolus doit résoudre)

    const hourToTime = (h: number) => new Date(`1970-01-01T${String(h).padStart(2, "0")}:00:00Z`)
    const parameterType = param === "isf" ? "insulinSensitivityFactor" : "insulinToCarbRatio"

    return prisma.$transaction(async (tx) => {
      // 2a. Scope patient (anti-IDOR) — le settingsId provient du patient, jamais du body.
      const settings = await tx.insulinTherapySettings.findUnique({ where: { patientId }, select: { id: true } })
      if (!settings) throw new Error("settingsNotFound")
      const settingsId = settings.id

      // 2b. Snapshot ancien jeu (audit `from`) + 2c. REPLACE scopé settingsId.
      if (param === "isf") {
        const before = await tx.insulinSensitivityFactor.findMany({
          where: { settingsId },
          select: { startHour: true, endHour: true },
        })
        await tx.insulinSensitivityFactor.deleteMany({ where: { settingsId } })
        await tx.insulinSensitivityFactor.createMany({
          data: slots.map((s) => ({
            settingsId,
            startHour: s.startHour,
            endHour: s.endHour,
            startTime: hourToTime(s.startHour),
            endTime: hourToTime(s.endHour),
            sensitivityFactorGl: s.value,
            sensitivityFactorMgdl: s.value * 100,
          })),
        })
        return finishReplaceSet(tx, param, parameterType, patientId, settingsId, before, slots, auditUserId, coverage, ctx)
      } else {
        const before = await tx.carbRatio.findMany({
          where: { settingsId },
          select: { startHour: true, endHour: true },
        })
        await tx.carbRatio.deleteMany({ where: { settingsId } })
        await tx.carbRatio.createMany({
          data: slots.map((s) => ({
            settingsId,
            startHour: s.startHour,
            endHour: s.endHour,
            startTime: hourToTime(s.startHour),
            endTime: hourToTime(s.endHour),
            gramsPerUnit: s.value,
            mealLabel: s.mealLabel,
          })),
        })
        return finishReplaceSet(tx, param, parameterType, patientId, settingsId, before, slots, auditUserId, coverage, ctx)
      }
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
