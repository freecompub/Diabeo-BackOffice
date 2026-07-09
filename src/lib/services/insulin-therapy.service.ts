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
import { tryLockInsulinSlots } from "@/lib/insulin/slot-lock"
import { glToMgdl } from "@/lib/statistics"

/**
 * Dérive la valeur `@db.Time` d'un créneau à partir de son heure entière `[0,23]`.
 * Source unique de la dénormalisation `startHour/endHour` → `startTime/endTime`
 * (réutilisée par createIsf/createIcr/replaceSlotSet). `hourToTime(24)` n'est jamais
 * appelé (endHour borné à 23 ; un profil complet enjambe minuit via `startHour > endHour`).
 */
const hourToTime = (h: number): Date => new Date(`1970-01-01T${String(h).padStart(2, "0")}:00:00Z`)

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
 * US-2657 — Pré-validation PURE (hors DB) d'un jeu complet de créneaux ISF/ICR, réutilisée par
 * `replaceSlotSet` (application directe DOCTOR) ET `createSetProposal` (soumission d'une proposition
 * d'ENSEMBLE) : une proposition qui ne pourra JAMAIS être appliquée ne doit pas pouvoir être créée
 * (fail-fast, symétrie création ⇄ acceptation). Bornes cliniques de valeur, durée non nulle,
 * no-overlap et **no-gap strict** (le bolus doit toujours résoudre un créneau). Source de vérité
 * unique des invariants de couverture ISF/ICR.
 * @param param - `"isf"` (value = g/L) ou `"icr"` (value = g/U).
 * @param slots - jeu complet `{ startHour, endHour, value, mealLabel? }`.
 * @returns couverture calculée (`{ hasGap, hasOverlap }`), réutilisable par l'appelant.
 * @throws emptySlotSet | zeroDurationSlot | valueOutOfBounds | slotOverlap | slotGap
 */
export function assertValidSlotSet(
  param: "isf" | "icr",
  slots: Array<{ startHour: number; endHour: number; value: number; mealLabel?: string }>,
): { hasGap: boolean; hasOverlap: boolean } {
  if (slots.length === 0) throw new Error("emptySlotSet")
  const [valMin, valMax] =
    param === "isf"
      ? [CLINICAL_BOUNDS.ISF_GL_MIN, CLINICAL_BOUNDS.ISF_GL_MAX]
      : [CLINICAL_BOUNDS.ICR_MIN, CLINICAL_BOUNDS.ICR_MAX]
  for (const s of slots) {
    if (s.startHour === s.endHour) throw new Error("zeroDurationSlot")
    // Bornes cliniques re-vérifiées côté service (défense en profondeur) : sûr même appelé
    // directement, pas seulement via la route Zod (US-2655, revue medical).
    if (s.value < valMin || s.value > valMax) throw new Error("valueOutOfBounds")
  }
  const coverage = analyzeSlotCoverage(slots.map((s) => ({ start: s.startHour * 60, end: s.endHour * 60 })))
  if (coverage.hasOverlap) throw new Error("slotOverlap")
  if (coverage.hasGap) throw new Error("slotGap") // ISF/ICR : no-gap strict (le bolus doit résoudre)
  return coverage
}

/**
 * US-2655 — Fin commune du remplacement de groupe (ISF/ICR), dans la transaction :
 * supersède les propositions `pending` du paramètre (baseline changé) puis journalise l'audit
 * `replaceSet` (`from → to`, sans PHI). Retourne le résumé.
 *
 * ⚠️ Supersède les DEUX familles de propositions du même `(patient × parameterType)` :
 *  - `AdjustmentProposal` par-valeur (libère `adjustment_proposals_one_pending_per_slot`) ;
 *  - `SlotSetProposal` d'ENSEMBLE (US-2657 : libère `slot_set_proposals_one_pending_per_param` et empêche
 *    qu'un jeu de créneaux PÉRIMÉ soit réappliqué plus tard — sinon l'accepter écraserait un ajustement
 *    médecin plus récent, ex. une baisse d'insuline post-hypo).
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
  supersededSetProposalIds: string[]
}> {
  // findMany puis updateMany partagent le même `where`. Une proposition `pending` insérée entre les
  // deux (course TOCTOU) serait supersédée sans figurer dans `supersededProposalIds` (sous-report du
  // retour) — sans impact sécurité : le statut DB reste correct. Cas extrême pour une action DOCTOR directe.
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

  // US-2657 — mêmes semantiques pour les propositions d'ENSEMBLE (`SlotSetProposal`). Ne touche PAS
  // la proposition en cours d'acceptation (déjà passée `accepted` avant l'apply) : seuls les `pending`
  // restants du même paramètre sont neutralisés.
  const supersededSet = await tx.slotSetProposal.findMany({
    where: { patientId, parameterType, status: "pending" },
    select: { id: true },
  })
  if (supersededSet.length > 0) {
    await tx.slotSetProposal.updateMany({
      where: { patientId, parameterType, status: "pending" },
      data: { status: "superseded", reviewedAt: new Date(), reviewedByUserId: auditUserId },
    })
  }
  const supersededSetProposalIds = supersededSet.map((p) => p.id)

  await auditService.logWithTx(tx, {
    userId: auditUserId,
    action: "UPDATE",
    resource: "INSULIN_THERAPY",
    resourceId: `${param}-set:${settingsId}`,
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
    requestId: ctx?.requestId,
    metadata: {
      patientId,
      op: "replaceSet",
      from: before.map((s) => ({ startHour: s.startHour, endHour: s.endHour })),
      to: slots.map((s) => ({ startHour: s.startHour, endHour: s.endHour })),
      supersededProposalIds,
      supersededSetProposalIds,
    },
  })

  return {
    applied: true as const,
    count: slots.length,
    coverage,
    supersededProposalIds,
    supersededSetProposalIds,
  }
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
    const sensitivityFactorMgdl = glToMgdl(input.sensitivityFactorGl)
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
          startTime: hourToTime(input.startHour),
          endTime: hourToTime(input.endHour),
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
   * US-2648b — Édition DIRECTE (DOCTOR) de la valeur d'un créneau ISF (`value` en **g/L**). `updateMany`
   * scopé au patient (via `settings.patientId`) → un id d'un autre patient ne matche pas (`count === 0`
   * → `isfSlotNotFound`, anti-IDOR). Ne modifie QUE la valeur, pas les heures (pas de re-check de
   * chevauchement). **Bornes cliniques re-validées ici** (défense en profondeur : ce chemin sert aussi
   * l'auto-application SANS médecin — US-2657). `externalTx` optionnel pour composer dans une transaction
   * englobante (harnais d'auto-application, atomicité apply + événement + audit).
   */
  async updateIsf(
    id: string,
    sensitivityFactorGl: number,
    auditUserId: number,
    patientId: number,
    ctx?: AuditContext,
    externalTx?: Prisma.TransactionClient,
  ) {
    if (sensitivityFactorGl < CLINICAL_BOUNDS.ISF_GL_MIN || sensitivityFactorGl > CLINICAL_BOUNDS.ISF_GL_MAX) {
      throw new Error("valueOutOfBounds")
    }
    const run = async (tx: Prisma.TransactionClient) => {
      // Exclusion mutuelle unifiée (patient×param), non bloquante : occupé → 409 (fail-closed, pas d'attente).
      if (!(await tryLockInsulinSlots(tx, patientId, "isf"))) throw new Error("slotsBusy")
      const res = await tx.insulinSensitivityFactor.updateMany({
        where: { id, settings: { patientId } },
        data: { sensitivityFactorGl, sensitivityFactorMgdl: glToMgdl(sensitivityFactorGl) },
      })
      if (res.count === 0) throw new Error("isfSlotNotFound")
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INSULIN_THERAPY",
        resourceId: `isf:${id}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: { patientId },
      })
      return { updated: true }
    }
    return externalTx ? run(externalTx) : prisma.$transaction(run)
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
          startTime: hourToTime(input.startHour),
          endTime: hourToTime(input.endHour),
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
  async updateIcr(
    id: string,
    gramsPerUnit: number,
    auditUserId: number,
    patientId: number,
    ctx?: AuditContext,
    externalTx?: Prisma.TransactionClient,
  ) {
    // Défense en profondeur (chemin auto-application sans médecin) : bornes ICR re-validées service.
    if (gramsPerUnit < CLINICAL_BOUNDS.ICR_MIN || gramsPerUnit > CLINICAL_BOUNDS.ICR_MAX) {
      throw new Error("valueOutOfBounds")
    }
    const run = async (tx: Prisma.TransactionClient) => {
      if (!(await tryLockInsulinSlots(tx, patientId, "icr"))) throw new Error("slotsBusy")
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
        requestId: ctx?.requestId,
        metadata: { patientId },
      })
      return { updated: true }
    }
    return externalTx ? run(externalTx) : prisma.$transaction(run)
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
   *   Corollaire : une **valeur unique sur 24 h** s'exprime en **≥ 2 créneaux** de même valeur
   *   (ex. `[0,12)` + `[12,0)`) — inhérent au résolveur `findSlotForHour` (aucun `[h,h)` ne couvre 24 h),
   *   pas un contournement. Un profil mono-créneau reçoit `slotGap` (422), fail-closed.
   *
   * **Anti-IDOR** : scopé `settings.patientId` ; le body ne porte jamais d'`id` de ligne.
   * **Dénormalisation** : `startHour/endHour` **et** `startTime/endTime` écrits ensemble.
   * **Propositions** : les `pending` du même `parameterType` pour ce patient sont **supersédées** — le
   * baseline a changé. S'applique aux DEUX familles : `AdjustmentProposal` par-valeur (libère
   * `adjustment_proposals_one_pending_per_slot`) ET `SlotSetProposal` d'ensemble (US-2657, libère
   * `slot_set_proposals_one_pending_per_param` et empêche la réapplication d'un jeu périmé).
   *
   * Chemin **DOCTOR direct** (application immédiate, `externalTx` absent) OU sous-étape de
   * `acceptSetProposal` (US-2657, `externalTx` fourni → même transaction que le flip de proposition).
   *
   * @param param - `"isf"` ou `"icr"`.
   * @param patientId - patient scopé (résolu serveur, anti-IDOR).
   * @param slots - jeu complet `{ startHour, endHour, value, mealLabel? }` (value = ISF g/L ou ICR g/U).
   * @param externalTx - transaction englobante optionnelle (atomicité apply + flip, cf. `acceptSetProposal`).
   * @throws emptySlotSet | zeroDurationSlot | valueOutOfBounds | slotOverlap | slotGap | settingsNotFound
   */
  async replaceSlotSet(
    param: "isf" | "icr",
    patientId: number,
    slots: Array<{ startHour: number; endHour: number; value: number; mealLabel?: string }>,
    auditUserId: number,
    ctx?: AuditContext,
    /**
     * US-2657 — transaction englobante optionnelle. Fournie par `acceptSetProposal` pour exécuter
     * l'apply DANS la même transaction que le flip de statut de la proposition (atomicité : jamais de
     * config appliquée sans acceptation valide, ni l'inverse). Absente (chemin DOCTOR direct) → on ouvre
     * notre propre transaction.
     */
    externalTx?: Prisma.TransactionClient,
  ): Promise<{
    applied: true
    count: number
    coverage: { hasGap: boolean; hasOverlap: boolean }
    supersededProposalIds: string[]
    supersededSetProposalIds: string[]
  }> {
    // 1. Pré-validation pure (hors DB, fail-fast) sur l'état FINAL — source unique `assertValidSlotSet`.
    const coverage = assertValidSlotSet(param, slots)
    const parameterType = param === "isf" ? "insulinSensitivityFactor" : "insulinToCarbRatio"

    const run = async (tx: Prisma.TransactionClient) => {
      // Exclusion mutuelle unifiée (patient×param), non bloquante — anti lost-update ; occupé → 409.
      if (!(await tryLockInsulinSlots(tx, patientId, param))) throw new Error("slotsBusy")
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
            sensitivityFactorMgdl: glToMgdl(s.value),
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
    }

    return externalTx ? run(externalTx) : prisma.$transaction(run)
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
  async updatePumpSlot(
    id: string,
    rate: number,
    auditUserId: number,
    patientId: number,
    ctx?: AuditContext,
    externalTx?: Prisma.TransactionClient,
  ) {
    // Garde-fő service (défense en profondeur, indépendante du Zod route) : un débit non
    // délivrable (hors incrément pompe / bornes) ne doit jamais être persisté, quel que soit l'appelant.
    if (!isDeliverableBasalRate(rate)) throw new Error("rateNotDeliverable")
    const run = async (tx: Prisma.TransactionClient) => {
      if (!(await tryLockInsulinSlots(tx, patientId, "basal"))) throw new Error("slotsBusy")
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
        requestId: ctx?.requestId,
        metadata: { patientId },
      })
      return { updated: true }
    }
    return externalTx ? run(externalTx) : prisma.$transaction(run)
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
