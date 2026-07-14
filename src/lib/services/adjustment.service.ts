/**
 * @module adjustment.service
 * @description Adjustment proposals — suggestions for ISF/ICR/basal changes based on data analysis.
 * Proposals are immutable once created and require doctor review (DOCTOR-only accept/reject).
 * Clinical bounds enforced before application.
 * @see CLAUDE.md#adjustment-proposals — Proposal workflow and clinical bounds
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { fcmService } from "./fcm.service"
import { logger } from "@/lib/logger"
import { INSULIN_BOUNDS } from "./insulin-therapy.service"
import { isDeliverableBasalRate, isDeliverableFixedDose } from "@/lib/clinical-bounds"
import { activeInsulinFilter } from "@/lib/insulin/active-insulin"
import type { AuditContext } from "./patient.service"
import type {
  ProposalStatus, Prisma, AdjustableParameter, AdjustmentReason, ProposalSource, DoseMoment, BasalDoseKind,
} from "@prisma/client"

/** Entrée STRUCTURÉE d'une proposition humaine (US-2649a). La provenance est
 *  dérivée du `proposer` authentifié, jamais du corps de requête (anti-usurpation). */
export type CreateProposalInput = {
  patientId: number
  parameterType: AdjustableParameter
  proposedValue: number
  reason: AdjustmentReason
  timeSlotStartHour?: number | null
  timeSlotEndHour?: number | null
  carbRatioSlotStart?: number | null
  carbRatioSlotEnd?: number | null
  pumpBasalSlotId?: string | null
  /** Discriminateur de créneau pour la DOSE FIXE (mode « doses simples »). */
  moment?: DoseMoment | null
  /** US-2659 — discriminateur de CIBLE d'une basale STYLO (MDI). Exclusif de `pumpBasalSlotId`. */
  basalDoseKind?: BasalDoseKind | null
  /** US-2659 (S3) — accusé DKA/jour-de-maladie du patient (consentement au risque de cétose d'une baisse
   *  basale). Requis `=== true` pour une baisse STYLO ; optionnel/persisté pour la pompe. */
  sickDayAcknowledged?: boolean
  /** Justification texte libre — chiffrée AES-256-GCM au stockage. */
  proposerComment?: string | null
}

/**
 * Garde-fou fail-closed de l'application d'une proposition acceptée : si aucune ligne n'a
 * été écrite (`count === 0` — créneau supprimé/déplacé ou hors patient entre la proposition
 * et l'accept), lève `code` → rollback de la transaction, jamais d'« accepté + appliqué »
 * fantôme. Partagé par les 3 paramètres (ISF/ICR/basal) pour éviter la dérive.
 */
function assertRowApplied(count: number, code: string): void {
  if (count === 0) throw new Error(code)
}

/**
 * Sens clinique impliqué par un `reason` de titration : `*TooLow` ⇒ HAUSSE, `*TooHigh` ⇒ BAISSE.
 * `null` pour un motif non directionnel (`*Correct`, `insufficientData`, motifs humains). Sert à
 * vérifier la cohérence `reason` ↔ signe du delta d'une proposition moteur (US-2651).
 *
 * US-2663 (S3b-1) — EXPORTÉ : la voie GROUPÉE (`emitGroupedIsfIcr`, proposal-generator) réapplique cette
 * garde défense-en-profondeur avant d'assembler la disposition (parité avec `reasonDirectionMismatch`
 * ci-dessous, que `createSetProposal` ne re-vérifie pas).
 */
export function reasonImpliesIncrease(reason: AdjustmentReason): boolean | null {
  if (reason.endsWith("TooLow")) return true
  if (reason.endsWith("TooHigh")) return false
  return null
}

/**
 * Valide une valeur proposée contre les bornes cliniques (re-vérification à l'application).
 * @private
 * @param parameterType Type de paramètre (`insulinSensitivityFactor`/`insulinToCarbRatio`/`basalRate`).
 * @param value Valeur proposée.
 * @param basalDoseKind Discriminateur de cible pour une basale STYLO (bornes U totales) vs pompe (U/h).
 * @returns `true` si la valeur est dans les bornes.
 */
function validateProposedValue(
  parameterType: string,
  value: number,
  basalDoseKind?: BasalDoseKind | null,
): boolean {
  switch (parameterType) {
    case "insulinSensitivityFactor":
      return value >= INSULIN_BOUNDS.ISF_GL_MIN && value <= INSULIN_BOUNDS.ISF_GL_MAX
    case "insulinToCarbRatio":
      return value >= INSULIN_BOUNDS.ICR_MIN && value <= INSULIN_BOUNDS.ICR_MAX
    case "basalRate":
      // US-2659 — basale STYLO (MDI, `basalDoseKind` fourni) : dose en UNITÉS TOTALES. Bornes propres
      // (`MDI_BASAL_MIN_U`, pas de plafond dur — U300/dégludec légitimes > 80 U ; le WARN est non
      // bloquant), délivrable à la demi-unité (`isDeliverableFixedDose`). JAMAIS les bornes pompe (U/h).
      if (basalDoseKind != null) {
        return value >= INSULIN_BOUNDS.MDI_BASAL_MIN_U && isDeliverableFixedDose(value)
      }
      // US-2648b — basale POMPE : débit PROGRAMMABLE = multiple de `PUMP_BASAL_INCREMENT` (0,05 U/h),
      // dans [BASAL_MIN ; BASAL_MAX]. Rejet à la création si non délivrable (profil rejeté à l'application).
      return (
        value >= INSULIN_BOUNDS.BASAL_MIN &&
        value <= INSULIN_BOUNDS.BASAL_MAX &&
        isDeliverableBasalRate(value)
      )
    // US-2646 — dose fixe (mode « doses simples »). SEUL le plancher de sanité bloque
    // (dose ≤ 0 / < 0,5 U invalide). PAS de plafond bloquant : une basale fixe peut
    // dépasser 25 U ; le dépassement des seuils théoriques (FIXED_BOLUS/BASAL_WARN_U)
    // déclenche un AVERTISSEMENT au service, pas un rejet. Delta/sens interdit patient
    // vérifiés à la création (service), pas ici.
    case "fixedDose":
      return value >= INSULIN_BOUNDS.FIXED_DOSE_MIN
    default:
      return false
  }
}

/**
 * US-2649a — valeur COURANTE de confiance d'un paramètre, lue **serveur** depuis la
 * config réelle du patient (jamais du body → garde-fous ininviolables) et **scopée
 * patient** (anti-IDOR : le créneau doit appartenir au patient).
 * @throws `slotRequired` (créneau/`moment` manquant), `currentValueNotFound` (créneau absent /
 *   autre patient). La dose fixe (US-2652) est ciblée par `moment` (scopée patient via `patientInsulin`).
 */
async function resolveCurrentValue(
  patientId: number,
  parameterType: AdjustableParameter,
  input: CreateProposalInput,
): Promise<number> {
  switch (parameterType) {
    case "insulinSensitivityFactor": {
      if (input.timeSlotStartHour == null) throw new Error("slotRequired")
      const row = await prisma.insulinSensitivityFactor.findFirst({
        where: { settings: { patientId }, startHour: input.timeSlotStartHour },
        select: { sensitivityFactorGl: true },
      })
      if (!row) throw new Error("currentValueNotFound")
      return Number(row.sensitivityFactorGl)
    }
    case "insulinToCarbRatio": {
      if (input.carbRatioSlotStart == null) throw new Error("slotRequired")
      const row = await prisma.carbRatio.findFirst({
        where: { settings: { patientId }, startHour: input.carbRatioSlotStart },
        select: { gramsPerUnit: true },
      })
      if (!row) throw new Error("currentValueNotFound")
      return Number(row.gramsPerUnit)
    }
    case "basalRate": {
      // US-2659 — basale STYLO (MDI) : ciblée par `basalDoseKind` (daily/morning/evening) sur
      // `BasalConfiguration` (scopée patient via `settings`, anti-IDOR). Dose en UNITÉS TOTALES.
      if (input.basalDoseKind != null) {
        const cfg = await prisma.basalConfiguration.findFirst({
          where: { settings: { patientId } },
          select: { dailyDose: true, morningDose: true, eveningDose: true },
        })
        if (!cfg) throw new Error("currentValueNotFound")
        const dose =
          input.basalDoseKind === "daily" ? cfg.dailyDose
          : input.basalDoseKind === "morning" ? cfg.morningDose
          : cfg.eveningDose
        if (dose == null) throw new Error("currentValueNotFound") // dose non configurée → fail-closed
        return Number(dose)
      }
      // Basale POMPE : ciblée par `pumpBasalSlotId` (créneau U/h), scopée patient.
      if (!input.pumpBasalSlotId) throw new Error("slotRequired")
      const row = await prisma.pumpBasalSlot.findFirst({
        where: { id: input.pumpBasalSlotId, basalConfig: { settings: { patientId } } },
        select: { rate: true },
      })
      if (!row) throw new Error("currentValueNotFound")
      return Number(row.rate)
    }
    // Dose fixe (US-2652) : ciblée par `moment` (colonne discriminante sur AdjustmentProposal).
    // Valeur courante lue SERVEUR depuis la `FixedDoseSlot` du patient (anti-IDOR : scopée patient).
    case "fixedDose": {
      if (!input.moment) throw new Error("slotRequired")
      const row = await prisma.fixedDoseSlot.findFirst({
        // US-2663 (S3d, revue) — filtre insuline ACTIVE : ne lit jamais la dose d'une insuline discontinuée.
        where: { patientInsulin: { patientId, ...activeInsulinFilter() }, moment: input.moment },
        select: { valueU: true },
      })
      if (!row) throw new Error("currentValueNotFound")
      return Number(row.valueU)
    }
    default:
      throw new Error("unsupportedParameter")
  }
}

/**
 * Adjustment proposal service — read/registry & review workflow (grouped-only depuis US-2663 S5 :
 * la voie d'ÉCRITURE par-valeur a été retirée ; ne subsistent que `list`/`summary`/`accept`/`reject`
 * sur les propositions `AdjustmentProposal` existantes).
 * @namespace adjustmentService
 */


export const adjustmentService = {
  /**
   * List adjustment proposals for a patient with optional filters.
   * @async
   * @param {number} patientId - Patient ID
   * @param {Object} filters - Query filters (status, parameterType, date range)
   * @param {number} auditUserId - User performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Array<Object>>} Proposals matching filters, newest first
   */
  async list(
    patientId: number,
    filters: {
      status?: ProposalStatus
      parameterType?: string
      from?: Date
      to?: Date
      // Étape 1 vue unifiée — restriction de PROVENANCE imposée SERVEUR (jamais depuis le body/query).
      // Sûreté (medical) : un patient ne doit recevoir QUE ses propres demandes (`["patient"]`) — voir une
      // dose non validée proposée par un soignant/l'algorithme l'exposerait à une auto-injection (ADR #13).
      // `undefined` = aucune restriction (clinicien : voit toutes les provenances).
      sources?: ProposalSource[]
    },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const where: Prisma.AdjustmentProposalWhereInput = { patientId }
    if (filters.status) where.status = filters.status
    if (filters.parameterType) where.parameterType = filters.parameterType as Prisma.EnumAdjustableParameterFilter
    if (filters.sources) where.source = { in: filters.sources }
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from && { gte: filters.from }),
        ...(filters.to && { lte: filters.to }),
      }
    }

    const proposals = await prisma.adjustmentProposal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      // HDS — ne JAMAIS émettre le ciphertext `proposerComment` dans la réponse (CLAUDE.md).
      // Strippé au SERVICE : tout consommateur de `list()` est protégé, pas seulement la route.
      // Le décryptage pour le médecin relecteur sera une tranche dédiée (US-2649b).
      omit: { proposerComment: true },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "ADJUSTMENT_PROPOSAL",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return proposals
  },

  /**
   * US-2649b — valeur COURANTE **LIVE** du créneau d'une proposition (re-lecture serveur au
   * moment de la revue), pour signaler au médecin si la config a changé depuis la proposition
   * (le `currentValue` stocké est un snapshot de création). Renvoie `null` si le créneau a
   * disparu/bougé (ISF/ICR par heure, basal par id, dose fixe par moment) ou n'est pas résoluble → l'UI n'affiche
   * alors pas de comparaison. Réutilise la lecture scopée patient de `resolveCurrentValue`.
   */
  async liveCurrentValue(
    patientId: number,
    proposal: {
      parameterType: AdjustableParameter
      timeSlotStartHour: number | null
      carbRatioSlotStart: number | null
      pumpBasalSlotId: string | null
      // US-2652 : sans `moment`, `resolveCurrentValue` lève `slotRequired` pour une dose fixe → CAS
      // `baselineMoved` inactif (une dose absolue périmée serait écrite). Doit être forwardé.
      moment: DoseMoment | null
      // US-2659 : idem pour la basale STYLO (résolution `dailyDose`/`morning`/`eveningDose`).
      basalDoseKind: BasalDoseKind | null
    },
  ): Promise<number | null> {
    try {
      return await resolveCurrentValue(patientId, proposal.parameterType, {
        patientId,
        parameterType: proposal.parameterType,
        proposedValue: 0,
        reason: "manualAdjustment",
        timeSlotStartHour: proposal.timeSlotStartHour,
        carbRatioSlotStart: proposal.carbRatioSlotStart,
        pumpBasalSlotId: proposal.pumpBasalSlotId,
        moment: proposal.moment,
        basalDoseKind: proposal.basalDoseKind,
      })
    } catch (err) {
      // Cas ATTENDUS (créneau absent/non résoluble) → null silencieux. Une erreur INATTENDUE
      // (panne DB, etc.) est loguée : sans ça, un échec de lecture masquerait l'avertissement
      // « config modifiée » sans trace (observabilité).
      const expected =
        err instanceof Error &&
        ["slotRequired", "currentValueNotFound"].includes(err.message)
      if (!expected) logger.error("adjustment", "liveCurrentValue read failed", { patientId }, err)
      return null
    }
  },

  /**
   * Get summary counts by status.
   * US-2664 — restriction de PROVENANCE optionnelle (`sources`), imposée SERVEUR (jamais du body/query),
   * cohérente avec `list()` : un PATIENT (VIEWER) ne doit compter QUE ses propres demandes (`["patient"]`).
   * Sans ce filtre, le compteur divulguerait l'EXISTENCE de propositions non validées d'un soignant/de
   * l'algorithme (métadonnée) — même frontière MDR que la liste (ADR #13). `undefined` = aucune restriction.
   */
  async summary(patientId: number, sources?: ProposalSource[]) {
    const src = sources ? { source: { in: sources } } : {}
    const [pending, accepted, rejected, expired] = await Promise.all([
      prisma.adjustmentProposal.count({ where: { patientId, status: "pending", ...src } }),
      prisma.adjustmentProposal.count({ where: { patientId, status: "accepted", ...src } }),
      prisma.adjustmentProposal.count({ where: { patientId, status: "rejected", ...src } }),
      prisma.adjustmentProposal.count({ where: { patientId, status: "expired", ...src } }),
    ])
    return { pending, accepted, rejected, expired, total: pending + accepted + rejected + expired }
  },

  /**
   * Accept a proposal — optionally apply the change (DOCTOR-validated, ADR #13).
   *
   * Quand `applyImmediately`, écrit la valeur ABSOLUE `proposedValue` sur le créneau ciblé,
   * scopé patient (anti-IDOR) et dans la transaction (atomique avec le passage `accepted`) :
   * ISF (`timeSlotStartHour`), ICR (`carbRatioSlotStart`), basale POMPE (`pumpBasalSlotId`, U/h),
   * dose fixe (`moment`) ou — US-2660 — basale STYLO (`basalDoseKind` → `dailyDose`/`morningDose`/
   * `eveningDose`, U totales, sur l'unique `BasalConfiguration` du patient).
   *
   * Gardes fail-closed (rollback, jamais d'« accepté + appliqué » fantôme) :
   * - `baselineMoved` (compare-and-swap explicite) si la valeur live a dérivé depuis la proposition ;
   * - CAS atomique DB : chaque `updateMany` verrouille la valeur attendue (`<colonne>: currentValue`)
   *   dans son `WHERE` → une base déplacée dans la fenêtre TOCTOU, ou une dose stylo effacée, matche
   *   0 ligne → `…SlotNotFound` / `styloBasalNotFound` (rollback) ;
   * - `basalTargetAmbiguous` si un `basalRate` porte les DEUX discriminateurs (invariant, inatteignable
   *   sous le CHECK base — filet en profondeur) ;
   * - `noApplicableApplyTarget` si `applyImmediately` est demandé sans cible résoluble (fantôme évité).
   *
   * @param proposalId    id de la proposition `pending`
   * @param reviewerId    id du DOCTOR relecteur (tracé dans `reviewedBy` + audit)
   * @param applyImmediately  applique la valeur au créneau (sinon accepte le statut sans écriture)
   * @param ctx           contexte d'audit (ip/userAgent)
   * @returns `{ accepted, applied, patientId }`
   * @throws `proposalNotFound` | `valueOutOfBounds` | `baselineMoved` | `…SlotNotFound` |
   *   `styloBasalNotFound` | `basalTargetAmbiguous` | `noApplicableApplyTarget`
   */
  async accept(
    proposalId: string,
    reviewerId: number,
    applyImmediately: boolean,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.adjustmentProposal.findUnique({ where: { id: proposalId } })
      if (!proposal || proposal.status !== "pending") {
        throw new Error("proposalNotFound")
      }

      await tx.adjustmentProposal.update({
        where: { id: proposalId },
        data: {
          status: "accepted",
          reviewedAt: new Date(),
          reviewedBy: reviewerId,
        },
      })

      // Apply the change if requested.
      if (applyImmediately) {
        const proposed = Number(proposal.proposedValue)

        // US-2660 (durcissement, medical INFO) — invariant d'exclusivité de la cible basale, vérifié
        // EN PREMIER (avant `validateProposedValue`, qui routerait « à l'aveugle » les bornes via
        // `basalDoseKind` alors que la cible réelle est ambiguë). Le CHECK base
        // `adjustment_proposals_basal_target_exclusivity_check` (migration 20260719100000) impose déjà
        // un XOR `pumpBasalSlotId ⊕ basalDoseKind` pour `basalRate` (donc ce garde est INATTEIGNABLE
        // aujourd'hui). Filet en profondeur : si une future migration affaiblissait le CHECK, l'ordre
        // `pompe (U/h) avant stylo (U totales)` du if-chain lirait la baseline stylo tout en écrivant le
        // débit pompe (catastrophique). Fail-closed AVANT toute écriture ni tout routage de bornes.
        if (proposal.parameterType === "basalRate" && proposal.pumpBasalSlotId && proposal.basalDoseKind != null) {
          throw new Error("basalTargetAmbiguous")
        }

        // Validation des bornes cliniques dures (fail-closed avant écriture).
        if (!validateProposedValue(proposal.parameterType, proposed, proposal.basalDoseKind)) {
          throw new Error("valueOutOfBounds")
        }

        // US-2649b / US-2660 — COMPARE-AND-SWAP (garde d'accès concurrent). `proposedValue` est une
        // valeur ABSOLUE calculée sur la base `currentValue` (snapshot de création). Si le créneau a
        // bougé depuis (édition médecin, autre proposition acceptée), l'appliquer sur-corrige (ex.
        // base descendue à 0.7 pour une hypo, proposition absolue 1.2 → +71 %). DEUX couches :
        //   1. Check EXPLICITE ci-dessous → `baselineMoved` (409 dédié, régénérer sur la vraie base) ;
        //      couvre la dérive détectable AVANT écriture. `null` (créneau disparu) laissé aux gardes
        //      d'apply (…SlotNotFound).
        //   2. Égalité `<colonne>: proposal.currentValue` DANS le `WHERE` de chaque `updateMany`
        //      (US-2660) → CAS ATOMIQUE côté DB. `liveCurrentValue` lit hors transaction (client global,
        //      pas `tx`) : une écriture concurrente peut se glisser ENTRE ce check et l'`updateMany`
        //      (TOCTOU). En verrouillant la valeur attendue dans le `WHERE`, une base déplacée dans
        //      cette fenêtre → 0 ligne → …SlotNotFound (rollback), jamais l'écrasement silencieux d'un
        //      changement concurrent. `proposal.currentValue` (Prisma Decimal) est passé tel quel :
        //      comparaison numérique Postgres exacte, sans imprécision flottante. Ce verrou subsume
        //      aussi le cas « dose stylo effacée » (NULL ≠ valeur → 0 ligne → styloBasalNotFound).
        const liveBase = await adjustmentService.liveCurrentValue(proposal.patientId, proposal)
        if (liveBase !== null && liveBase !== Number(proposal.currentValue)) {
          throw new Error("baselineMoved")
        }
        // INVARIANT (verrouillé par tests/unit/cas-decimal-scale-invariant.test.ts) : `currentValue`
        // est `Decimal(8,4)` (scale 4) et TOUTES les colonnes de dose cibles ont une scale ≤ 4 (ISF 4,
        // pompe 3, ICR/dose fixe/stylo 2). Le round-trip `colonne → currentValue` à la création est donc
        // SANS troncature, et l'égalité CAS `<colonne>: casValue` matche exactement une base inchangée.
        // ⚠️ Si une future migration portait une colonne de dose à une scale > 4, `currentValue`
        // tronquerait → faux fail-closed sur un apply LÉGITIME (dégradation de disponibilité, jamais une
        // mauvaise dose). Le test de garde ci-dessus casse dans ce cas — ne pas contourner sans revoir ce CAS.
        const casValue = proposal.currentValue // Prisma Decimal — verrou CAS dans le WHERE

        if (proposal.parameterType === "insulinSensitivityFactor" && proposal.timeSlotStartHour != null) {
          const res = await tx.insulinSensitivityFactor.updateMany({
            where: {
              settings: { patientId: proposal.patientId },
              startHour: proposal.timeSlotStartHour,
              sensitivityFactorGl: casValue,
            },
            data: {
              sensitivityFactorGl: proposed,
              sensitivityFactorMgdl: proposed * 100,
            },
          })
          // Fail-closed : si le créneau a disparu/bougé entre proposition et accept, ne pas
          // laisser un « accepté + appliqué » fantôme (le médecin croirait la valeur active).
          assertRowApplied(res.count, "isfSlotNotFound")
        } else if (proposal.parameterType === "insulinToCarbRatio" && proposal.carbRatioSlotStart != null) {
          const res = await tx.carbRatio.updateMany({
            where: {
              settings: { patientId: proposal.patientId },
              startHour: proposal.carbRatioSlotStart,
              gramsPerUnit: casValue,
            },
            data: { gramsPerUnit: proposed },
          })
          assertRowApplied(res.count, "icrSlotNotFound")
        } else if (proposal.parameterType === "basalRate" && proposal.pumpBasalSlotId) {
          // Re-scopé au patient de la proposition (défense en profondeur, anti-IDOR) :
          // un pumpBasalSlotId qui n'appartiendrait pas au patient ne matche pas → count 0
          // → fail-closed (créneau introuvable), jamais d'écriture cross-patient.
          const res = await tx.pumpBasalSlot.updateMany({
            where: {
              id: proposal.pumpBasalSlotId,
              basalConfig: { settings: { patientId: proposal.patientId } },
              rate: casValue,
            },
            data: { rate: proposed },
          })
          assertRowApplied(res.count, "pumpSlotNotFound")
        } else if (proposal.parameterType === "fixedDose" && proposal.moment != null) {
          // Dose fixe (US-2652) — scopée patient via la relation `patientInsulin` (anti-IDOR) : un
          // moment hors patient ne matche pas → count 0 → fail-closed (créneau introuvable).
          const res = await tx.fixedDoseSlot.updateMany({
            // US-2663 (S3d, revue) — filtre insuline ACTIVE : n'écrit jamais sur une insuline discontinuée.
            where: { patientInsulin: { patientId: proposal.patientId, ...activeInsulinFilter() }, moment: proposal.moment, valueU: casValue },
            data: { valueU: proposed },
          })
          // US-2663 (S3d) — fail-closed sur l'AMBIGUÏTÉ d'usage. Le modèle par-valeur ne porte PAS l'usage
          // (`moment` seul) : si deux `PatientInsulin` (ex. bolus rapide + basale lente) partagent ce moment ET
          // cette valeur, le `updateMany` toucherait PLUSIEURS lignes (count > 1) — écriture multiple silencieuse
          // sur la mauvaise insuline. On REFUSE désormais (avant : seul count 0 était gardé, count > 1 passait).
          // La voie GROUPÉE (S3d) résout par `(usage, moment)` et n'a pas cette ambiguïté. (À valider medical.)
          if (res.count === 0) throw new Error("fixedDoseSlotNotFound")
          if (res.count > 1) throw new Error("fixedDoseSlotAmbiguous")
        } else if (proposal.parameterType === "basalRate" && proposal.basalDoseKind != null) {
          // US-2660 — ÉCRITURE GROUPÉE de la basale STYLO (MDI). La dose ciblée par `basalDoseKind`
          // (`dailyDose`/`morningDose`/`eveningDose`, UNITÉS TOTALES) est écrite sur l'unique
          // `BasalConfiguration` du patient (contrainte `settingsId @unique` + `patientId @unique` →
          // 1 config/patient : le `updateMany` scopé patient touche au plus 1 ligne, cohérent avec la
          // lecture `resolveCurrentValue`). Scopé patient via `settings` (anti-IDOR). Le verrou CAS
          // `<colonne>: casValue` (cf. ci-dessus) subsume le fail-closed « dose effacée » (NULL ≠
          // valeur → 0 ligne → `styloBasalNotFound`, rollback — jamais de réintroduction silencieuse
          // d'une dose supprimée, ni d'« accepté + appliqué » fantôme).
          const column =
            proposal.basalDoseKind === "daily" ? "dailyDose"
            : proposal.basalDoseKind === "morning" ? "morningDose"
            : "eveningDose"
          const res = await tx.basalConfiguration.updateMany({
            where: {
              settings: { patientId: proposal.patientId },
              [column]: casValue,
            },
            data: { [column]: proposed },
          })
          assertRowApplied(res.count, "styloBasalNotFound")
        } else {
          // US-2660 (code-review MED) — filet fail-closed : `applyImmediately` demandé mais AUCUNE
          // cible résolue (couple parameterType×discriminateur inattendu — p.ex. une proposition
          // héritée sans discriminateur de créneau, non gardée par `resolveCurrentValue`).
          // Sans ce garde, la fonction retournerait `applied: true` SANS écriture (fantôme). Rollback.
          throw new Error("noApplicableApplyTarget")
        }
      }

      await auditService.logWithTx(tx, {
        userId: reviewerId,
        action: "PROPOSAL_ACCEPTED",
        resource: "ADJUSTMENT_PROPOSAL",
        resourceId: proposalId,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { applyImmediately, patientId: proposal.patientId },
      })

      return { accepted: true, applied: applyImmediately, patientId: proposal.patientId }
    })
  },

  /** Reject a proposal */
  async reject(proposalId: string, reviewerId: number, ctx?: AuditContext) {
    const result = await prisma.$transaction(async (tx) => {
      const proposal = await tx.adjustmentProposal.findUnique({ where: { id: proposalId } })
      if (!proposal || proposal.status !== "pending") {
        throw new Error("proposalNotFound")
      }

      await tx.adjustmentProposal.update({
        where: { id: proposalId },
        data: {
          status: "rejected",
          reviewedAt: new Date(),
          reviewedBy: reviewerId,
        },
      })

      await auditService.logWithTx(tx, {
        userId: reviewerId,
        action: "PROPOSAL_REJECTED",
        resource: "ADJUSTMENT_PROPOSAL",
        resourceId: proposalId,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return { rejected: true, patientId: proposal.patientId }
    })

    return result
  },

  async notifyPatient(patientId: number, senderId: number, action: "accepted" | "rejected", ctx?: AuditContext): Promise<{ notified: boolean }> {
    // BEST-EFFORT, JAMAIS bloquant : cette notification est appelée APRÈS le commit de l'accept/reject
    // (proposition déjà appliquée). Toute défaillance — y compris un aléa DB sur le `findFirst` — doit
    // renvoyer `{ notified: false }`, jamais throw (sinon la route renverrait 500 sur un acte déjà réussi,
    // induisant un retry inutile). Le `try` englobe donc TOUTE la méthode (revue code-reviewer S1, US-2663).
    const titles: Record<string, string> = {
      accepted: "Proposition acceptée",
      rejected: "Proposition refusée",
    }
    const bodies: Record<string, string> = {
      accepted: "Votre médecin a accepté une proposition d'ajustement de traitement.",
      rejected: "Votre médecin a refusé une proposition d'ajustement.",
    }

    try {
      const patient = await prisma.patient.findFirst({
        where: { id: patientId, deletedAt: null },
        select: { userId: true },
      })
      if (!patient) return { notified: false }

      const result = await fcmService.sendToUser({
        userId: patient.userId,
        senderId,
        title: titles[action],
        body: bodies[action],
        data: { type: "proposal_update", action },
      }, ctx)
      return { notified: result.sent > 0 }
    } catch (err) {
      logger.error("adjustment", "Push notification failed", { patientId }, err)
      return { notified: false }
    }
  },
}
