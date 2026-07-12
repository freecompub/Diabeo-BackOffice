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
import { analyzeSlotCoverage } from "@/lib/insulin/slot-coverage"
import { tryLockInsulinSlots } from "@/lib/insulin/slot-lock"
import { assertBaselineUnchanged } from "@/lib/insulin/slot-baseline-cas"
import type { IsfIcrSlot } from "@/lib/insulin/grouped-proposal"
import { glToMgdl } from "@/lib/statistics"

/**
 * Dérive la valeur `@db.Time` d'un créneau à partir de son heure entière `[0,23]`.
 * Source unique de la dénormalisation `startHour/endHour` → `startTime/endTime`
 * (réutilisée par `replaceSlotSet`). `hourToTime(24)` n'est jamais
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

/** `"HH:MM"` → minutes dans [0,1440[ ; `null` si le format est invalide (défense en profondeur hors Zod). */
function hhmmToMinutes(t: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * US-2657 — Garde de validité clinique d'un **jeu de créneaux BASAUX** (pompe), pendant basal du
 * `assertValidSlotSet` ISF/ICR mais pour le modèle `PumpBasalSlot` (temps `HH:MM`, débit U/h).
 *
 * Règles (source de vérité clinique = `clinical-bounds.ts`) :
 *  - jeu non vide (`emptySlotSet`), aucun créneau de durée nulle (`zeroDurationSlot`) ni temps illisible
 *    (`invalidSlotSet`) ;
 *  - débit dans les bornes `[BASAL_MIN, BASAL_MAX]` (`valueOutOfBounds`) ET **délivrable** — multiple de
 *    l'incrément pompe `PUMP_BASAL_INCREMENT` 0,05 U/h (`rateNotDeliverable`) ;
 *  - **no-overlap** (`slotOverlap`) : un chevauchement = double délivrance basale = sur-dosage ;
 *  - **no-gap STRICT** (`slotGap`) : ⚠️ *décision à confirmer par `medical-domain-validator`* — une pompe
 *    délivre en permanence un débit de fond ; un trou = fenêtre SANS basale = risque hyperglycémie/DKA.
 *    Invariant PLUS STRICT que l'ancienne voie par-créneau (qui tolérait les trous). Le `PUT` groupé envoie
 *    le jeu ENTIER, l'UI garantit la couverture 24 h → pas de régression pour un profil bien formé.
 *
 * @throws emptySlotSet | zeroDurationSlot | invalidSlotSet | valueOutOfBounds | rateNotDeliverable | slotOverlap | slotGap
 */
export function assertValidPumpSlotSet(
  slots: Array<{ startTime: string; endTime: string; rate: number }>,
): { hasGap: boolean; hasOverlap: boolean } {
  if (slots.length === 0) throw new Error("emptySlotSet")
  const raw: { start: number; end: number }[] = []
  for (const s of slots) {
    const start = hhmmToMinutes(s.startTime)
    const end = hhmmToMinutes(s.endTime)
    if (start === null || end === null) throw new Error("invalidSlotSet")
    if (start === end) throw new Error("zeroDurationSlot")
    // Bornes cliniques re-vérifiées côté service (défense en profondeur, hors Zod route).
    if (s.rate < CLINICAL_BOUNDS.BASAL_MIN || s.rate > CLINICAL_BOUNDS.BASAL_MAX) throw new Error("valueOutOfBounds")
    if (!isDeliverableBasalRate(s.rate)) throw new Error("rateNotDeliverable")
    raw.push({ start, end })
  }
  const coverage = analyzeSlotCoverage(raw)
  if (coverage.hasOverlap) throw new Error("slotOverlap")
  if (coverage.hasGap) throw new Error("slotGap")
  return coverage
}

/** `PumpBasalSlot.startTime`/`endTime` (Time stocké `1970-01-01THH:MM:00Z`) → `"HH:MM"` (audit, sans PHI). */
const pumpTimeToHhmm = (t: Date): string => t.toISOString().slice(11, 16)

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
        // US-2662 — molécule basale : SEULE la durée d'action est chargée (minimisation RGPD), pour
        // sélectionner le cooldown de titration MDI (ultra-longue dégludec/U300 vs classique glargine/detemir).
        basalInsulin: {
          select: { insulinCatalog: { select: { typicalDurationHours: true } } },
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

  // --- ISF / ICR : édition par-créneau RETIRÉE (US-2657 grouped-only, ADR #26 + retrait auto-application) ---
  //     Toute écriture ISF/ICR passe EXCLUSIVEMENT par le remplacement GROUPÉ `replaceSlotSet` ci-dessous
  //     (createIsf/updateIsf/deleteIsf + createIcr/updateIcr/deleteIcr supprimés — plus aucun appelant après
  //     le retrait de l'auto-application experte, seule voie qui consommait ces primitives par-créneau).

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
    /**
     * US-2663 (S1) — CAS D'ENSEMBLE fail-closed. **Enveloppé dans un objet à dessein** (durcissement revue) :
     * demander le CAS est un acte EXPLICITE (`{ baseline }`), jamais un effet de bord d'une valeur « vide ».
     * - **Omis** (`undefined`) ⇒ chemin DOCTOR direct : PAS de CAS (le médecin écrase explicitement). Le
     *   fail-open n'est donc atteignable qu'en n'AJOUTANT PAS le paramètre — un `null` mal coalescé ne compile pas.
     * - `{ baseline: IsfIcrSlot[] }` ⇒ la base LIVE (lue sous verrou) doit être identique, sinon `baselineMoved`.
     * - `{ baseline: null }` ⇒ proposition legacy sans snapshot ⇒ `baselineMissing` (fail-closed).
     */
    cas?: { baseline: IsfIcrSlot[] | null },
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

      // 2a-bis. US-2663 (S1) — CAS D'ENSEMBLE fail-closed (acceptation groupée uniquement). Sous le verrou
      //   `tryLockInsulinSlots` déjà acquis ⇒ lecture LIVE atomique (pas de TOCTOU) : la base actuelle doit
      //   être identique au snapshot pris à la génération. Une dérive (ajustement médecin concurrent) →
      //   `baselineMoved` ; snapshot absent (legacy) → `baselineMissing`. Rollback ⇒ proposition reste `pending`.
      //   `orderBy` sans effet fonctionnel ici (comparaison par `Map` sur `startHour`) — gardé par symétrie S0.
      if (cas !== undefined) {
        const live: IsfIcrSlot[] =
          param === "isf"
            ? (
                await tx.insulinSensitivityFactor.findMany({
                  where: { settingsId },
                  orderBy: { startHour: "asc" },
                  select: { startHour: true, endHour: true, sensitivityFactorGl: true },
                })
              ).map((s) => ({ startHour: s.startHour, endHour: s.endHour, value: Number(s.sensitivityFactorGl) }))
            : (
                await tx.carbRatio.findMany({
                  where: { settingsId },
                  orderBy: { startHour: "asc" },
                  select: { startHour: true, endHour: true, gramsPerUnit: true },
                })
              ).map((s) => ({ startHour: s.startHour, endHour: s.endHour, value: Number(s.gramsPerUnit) }))
        assertBaselineUnchanged(cas.baseline, live)
      }

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

  /**
   * US-2657 (grouped-only) — Remplace ATOMIQUEMENT tout le jeu de créneaux BASAUX (pompe) du patient.
   * Voie GROUPÉE unique de l'édition basale (les écritures par-créneau POST/PATCH/DELETE sont retirées).
   * Pendant du `replaceSlotSet` ISF/ICR pour le modèle `PumpBasalSlot` (temps `HH:MM`).
   *
   * Atomicité + sûreté : verrou non bloquant `(patient × basal)` (occupé → `slotsBusy`/409, anti lost-update) ;
   * `settingsId`/`basalConfigId` dérivés du **patient** (anti-IDOR, jamais du body) ; validité clinique/couverture
   * pré-validée (`assertValidPumpSlotSet`) ; `deleteMany` + `createMany` dans une seule transaction (jamais
   * d'application partielle). Refuse un patient NON pompe (`basalConfigNotPump`, intégrité du mode). Supersède
   * les `AdjustmentProposal` **basales** `pending` (baseline changé). Audit `replaceSet` sans PHI.
   *
   * @throws slotsBusy | settingsNotFound | basalConfigNotFound | basalConfigNotPump
   * @throws emptySlotSet | zeroDurationSlot | invalidSlotSet | valueOutOfBounds | rateNotDeliverable | slotOverlap | slotGap
   */
  async replacePumpSlotSet(
    patientId: number,
    slots: Array<{ startTime: string; endTime: string; rate: number }>,
    auditUserId: number,
    ctx?: AuditContext,
    externalTx?: Prisma.TransactionClient,
  ): Promise<{
    applied: true
    count: number
    coverage: { hasGap: boolean; hasOverlap: boolean }
    supersededProposalIds: string[]
  }> {
    // 1. Pré-validation pure (hors DB, fail-fast) — source unique `assertValidPumpSlotSet`.
    const coverage = assertValidPumpSlotSet(slots)

    const run = async (tx: Prisma.TransactionClient) => {
      if (!(await tryLockInsulinSlots(tx, patientId, "basal"))) throw new Error("slotsBusy")
      // Scope patient (anti-IDOR) : basalConfigId provient du patient, jamais du body.
      const settings = await tx.insulinTherapySettings.findUnique({
        where: { patientId },
        select: { id: true, basalConfiguration: { select: { id: true, configType: true } } },
      })
      if (!settings) throw new Error("settingsNotFound")
      const basalConfig = settings.basalConfiguration
      if (basalConfig == null) throw new Error("basalConfigNotFound")
      // Intégrité du mode de délivrance : les créneaux basaux N'ont de sens QUE pour une pompe. Un patient
      // MDI (`single_injection`/`split_injection`) possède aussi une `basalConfiguration` ; y attacher des
      // `PumpBasalSlot` fausserait la dérivation du mode de traitement (pompe vs injection). Fail-closed.
      if (basalConfig.configType !== "pump") throw new Error("basalConfigNotPump")
      const basalConfigId = basalConfig.id

      // Snapshot ancien jeu (audit `from`) + REPLACE scopé basalConfigId.
      const before = await tx.pumpBasalSlot.findMany({
        where: { basalConfigId },
        select: { startTime: true, endTime: true },
      })
      await tx.pumpBasalSlot.deleteMany({ where: { basalConfigId } })
      await tx.pumpBasalSlot.createMany({
        data: slots.map((s) => ({
          basalConfigId,
          startTime: new Date(`1970-01-01T${s.startTime}:00Z`),
          endTime: new Date(`1970-01-01T${s.endTime}:00Z`),
          rate: s.rate,
        })),
      })

      // Baseline basale changée → supersède les propositions basales `pending` (par-valeur).
      // INVARIANT : aucune `SlotSetProposal` basale à superséder ici. Bien que la colonne DB
      // `slot_set_proposals.parameter_type` (`AdjustableParameter`) *inclue* `basalRate`, le type applicatif
      // `SlotSetParam` restreint la CRÉATION à isf/icr et `applyGroupProposal` LÈVE `unsupportedSlotSetParam`
      // sur toute autre valeur → un `SlotSetProposal` basal ne peut être ni créé ni appliqué. La fenêtre de
      // « dérive de base » est donc close des deux côtés pour le basal sans supersede d'ensemble ici.
      // (revue medical-domain-validator #710 — LOW ; durcissement DB CHECK possible mais non requis.)
      const superseded = await tx.adjustmentProposal.findMany({
        where: { patientId, parameterType: "basalRate", status: "pending" },
        select: { id: true },
      })
      if (superseded.length > 0) {
        await tx.adjustmentProposal.updateMany({
          where: { patientId, parameterType: "basalRate", status: "pending" },
          data: { status: "superseded", reviewedAt: new Date(), reviewedBy: auditUserId },
        })
      }
      const supersededProposalIds = superseded.map((p) => p.id)

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INSULIN_THERAPY",
        resourceId: `basal-set:${basalConfigId}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          patientId,
          op: "replaceSet",
          param: "basal",
          from: before.map((s) => ({ startTime: pumpTimeToHhmm(s.startTime), endTime: pumpTimeToHhmm(s.endTime) })),
          to: slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime })),
          supersededProposalIds,
        },
      })

      return { applied: true as const, count: slots.length, coverage, supersededProposalIds }
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

  // --- Pump Basal Slots : édition par-créneau RETIRÉE (US-2657 grouped-only, ADR #26 + retrait
  //     auto-application) — createPumpSlot/updatePumpSlot/deletePumpSlot supprimés. Toute écriture basale
  //     passe EXCLUSIVEMENT par le remplacement GROUPÉ `replacePumpSlotSet`. ---

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
