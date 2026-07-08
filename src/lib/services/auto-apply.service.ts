/**
 * US-2657 (slice C2b) — **Harnais gouverné de l'auto-application experte** (frontière MDR).
 *
 * Point d'entrée où l'enveloppe est ENFIN appelée. Orchestre : gardes MDR (patient insuliné, unité ISF) →
 * **double verrou** (kill-switch global × flag patient × GovernanceApproval active) → assemblage du contexte
 * (`buildEnvelopeContext`) → décision PURE (`evaluateAutoApplyEnvelope`) → **dispatch** :
 *  - `AUTO_APPLY` → **transaction unique** : advisory-lock par (patient × param × créneau) + **re-évaluation
 *    sous lock** (ferme le TOCTOU anti-cliquet C7) + `AutoApplyEvent` + application (`updateIsf/…`, `externalTx`)
 *    + audit `AUTO_APPLIED_SETTING`. Atomique : dose, événement anti-cliquet et audit commitent ensemble ou pas ;
 *  - `FALLBACK_PROPOSAL` → crée une `AdjustmentProposal` (voie médecin) + audit `AUTO_APPLY_FALLBACK` ;
 *  - `HARD_REJECT` (ou frontière MDR) → audit `AUTO_APPLY_REJECTED`, n'applique rien.
 *
 * **Périmètre** : paramètres à créneau ISF/ICR/basal (dialogue d'édition de créneaux). La dose fixe suit un
 * autre chemin → non supporté ici (rejeté par le type). Édition **par-créneau `VALUE`** ; la sémantique
 * GROUPE tout-ou-rien (plusieurs créneaux, restructuration) relève de l'orchestrateur C3b `applyExpertGroupGoverned`.
 *
 * **Autorité** : l'appelant (route C3) porte l'authz (rôle/portefeuille) ; ce service reçoit un `patientId`
 * déjà autorisé, audite la décision, et `now` est injecté (pas d'horloge cachée).
 */
import type { AdjustableParameter, AdjustmentReason, Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { decimalToNumber } from "@/lib/db/decimal"
import { isAutoApplyGloballyEnabled } from "@/lib/env"
import { KETONE_DEFAULTS } from "@/lib/services/ketone-threshold.service"
import { buildEnvelopeContext } from "@/lib/insulin/auto-apply-context"
import { evaluateAutoApplyEnvelope } from "@/lib/insulin/auto-apply-envelope"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { adjustmentService, type CreateProposalInput } from "@/lib/services/adjustment.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { auditService, type AuditContext } from "@/lib/services/audit.service"

/** Paramètres à créneau gérés par le harnais (la dose fixe suit un autre chemin). */
export type SlotParam = "insulinSensitivityFactor" | "insulinToCarbRatio" | "basalRate"

export type ExpertSlotEdit = {
  patientId: number
  parameterType: SlotParam
  /** Id DB du créneau (ISF/ICR) ou du slot basal — pour l'application anti-IDOR. */
  slotId: string
  startHour: number
  endHour: number
  currentValue: number
  proposedValue: number
  changeKind: "VALUE" | "STRUCTURAL"
  isfUnit?: "gl" | "mgdl"
  windowDays?: number
}

export type GovernedOutcome =
  | { outcome: "applied" }
  | { outcome: "noop" }
  | { outcome: "proposal"; failedCheck: string; proposalId: string }
  | { outcome: "rejected"; reason: string }

/**
 * Applique la nouvelle valeur du créneau via la primitive scopée (anti-IDOR + bornes re-validées + audit
 * hérités). `tx` propagé pour rester dans la transaction du harnais (atomicité apply + événement + audit).
 */
async function applySlotValue(
  edit: ExpertSlotEdit,
  actorUserId: number,
  ctx: AuditContext | undefined,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const { slotId, proposedValue, patientId } = edit
  switch (edit.parameterType) {
    case "insulinSensitivityFactor":
      await insulinTherapyService.updateIsf(slotId, proposedValue, actorUserId, patientId, ctx, tx)
      return
    case "insulinToCarbRatio":
      await insulinTherapyService.updateIcr(slotId, proposedValue, actorUserId, patientId, ctx, tx)
      return
    case "basalRate":
      await insulinTherapyService.updatePumpSlot(slotId, proposedValue, actorUserId, patientId, ctx, tx)
      return
    default: {
      // Garde d'exhaustivité : sans ce `never`, un futur SlotParam non câblé ferait un no-op silencieux
      // (fail-open : "applied" sans dose appliquée).
      const _never: never = edit.parameterType
      throw new Error(`autoApply: unsupported slot parameter ${String(_never)}`)
    }
  }
}

/** Construit l'entrée de proposition (voie médecin) — provenance patient, reason `patientRequested`. */
function toProposalInput(edit: ExpertSlotEdit): CreateProposalInput {
  const base = {
    patientId: edit.patientId,
    parameterType: edit.parameterType as AdjustableParameter,
    proposedValue: edit.proposedValue,
    reason: "patientRequested" as AdjustmentReason,
  }
  switch (edit.parameterType) {
    case "insulinSensitivityFactor":
      return { ...base, timeSlotStartHour: edit.startHour, timeSlotEndHour: edit.endHour }
    case "insulinToCarbRatio":
      return { ...base, carbRatioSlotStart: edit.startHour, carbRatioSlotEnd: edit.endHour }
    case "basalRate":
      return { ...base, pumpBasalSlotId: edit.slotId }
  }
}

/** Audit de la DÉCISION d'enveloppe (trail gouvernance/MDR, sans PHI). Action DÉDIÉE (forensique). */
async function auditDecision(
  patientId: number,
  actorUserId: number,
  action: "AUTO_APPLY_FALLBACK" | "AUTO_APPLY_REJECTED",
  meta: Record<string, unknown>,
  ctx?: AuditContext,
): Promise<void> {
  await auditService.log({
    userId: actorUserId,
    action,
    resource: "PATIENT",
    resourceId: String(patientId),
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
    requestId: ctx?.requestId,
    metadata: { patientId, ...meta },
  })
}

export const autoApplyService = {
  /**
   * Évalue et applique/propose/rejette une édition de créneau d'un patient EXPERT, sous gouvernance.
   * @param edit Édition de créneau (déjà validée/autorisée par l'appelant).
   * @param actorUserId Acteur (le patient, pour la proposition et l'audit).
   * @param now Instant de référence (injecté).
   * @param ctx Contexte requête (audit).
   * @throws `patientNotFound` (absent/soft-deleted) ; `isfUnitMustBeGl` (édition ISF non g/L, fail-closed).
   */
  async applyExpertEditGoverned(
    edit: ExpertSlotEdit,
    actorUserId: number,
    now: Date,
    ctx?: AuditContext,
  ): Promise<GovernedOutcome> {
    const { patientId, parameterType, startHour, endHour, currentValue, proposedValue, changeKind, isfUnit, windowDays } = edit

    // No-op : aucune modification réelle → rien n'est écrit (pas d'événement anti-cliquet ni d'audit fantôme).
    if (Number.isFinite(currentValue) && proposedValue === currentValue) return { outcome: "noop" }

    // Garde d'unité ISF (fail-closed) : la primitive persiste en g/L. Une édition ISF en mg/dL corromprait
    // la valeur (mg/dL écrit tel quel comme g/L) — on refuse plutôt que de convertir en aveugle.
    if (parameterType === "insulinSensitivityFactor" && isfUnit && isfUnit !== "gl") {
      throw new Error("isfUnitMustBeGl")
    }

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { maturityLevel: true, autoApply: true },
    })
    if (!patient) throw new Error("patientNotFound")

    // Frontière DISPOSITIF MÉDICAL : un patient NON INSULINÉ ne reçoit JAMAIS de dose auto-appliquée
    // (mode dérivé serveur, fail-closed). Défense sur la branche AUTO_APPLY (la plus dangereuse, sans PS).
    const { mode } = await treatmentModeService.resolveTreatmentMode(patientId)
    if (mode === "nonInsulin") {
      const slotKey = `${startHour}-${endHour}`
      await auditDecision(patientId, actorUserId, "AUTO_APPLY_REJECTED", { parameterType, slotKey, reason: "nonInsulinNoDose" }, ctx)
      return { outcome: "rejected", reason: "nonInsulinNoDose" }
    }

    const kt = await prisma.ketoneThreshold.findUnique({ where: { patientId }, select: { moderateThreshold: true } })
    const ketoneModerateThreshold = kt ? decimalToNumber(kt.moderateThreshold) : KETONE_DEFAULTS.moderateThreshold

    // Verrou : kill-switch global × flag patient × **existence** d'un artefact de gouvernance. Ce 3e facteur
    // est une garde d'EXISTENCE, pas d'activité : `GovernanceApproval` est append-only (`enabled` toujours
    // true, jamais révoqué — la révocation passe par le flag `autoApply`, pas par ce row). Il protège donc
    // uniquement contre un `autoApply=true` posé SANS aucun artefact (manip DB directe / futur chemin buggé) ;
    // la protection contre une ré-élévation de maturité vient du reset `autoApply=false` au downgrade.
    const globalOn = isAutoApplyGloballyEnabled()
    const hasGovernanceApproval = (await prisma.governanceApproval.count({ where: { patientId, enabled: true } })) > 0
    const effectiveAutoApply = globalOn && patient.autoApply && hasGovernanceApproval
    const slotKey = `${startHour}-${endHour}`

    const context = await buildEnvelopeContext(patientId, parameterType, slotKey, ketoneModerateThreshold, now, windowDays)

    const evalInput = {
      authority: { maturityLevel: patient.maturityLevel, autoApply: effectiveAutoApply },
      change: { parameterType, changeKind, currentValue, proposedValue, isfUnit },
      glycemia: context.glycemia,
      ratchet: context.ratchet,
    }
    const decision = evaluateAutoApplyEnvelope(evalInput)

    if (decision.decision === "HARD_REJECT") {
      await auditDecision(patientId, actorUserId, "AUTO_APPLY_REJECTED", { parameterType, slotKey, reason: decision.reason }, ctx)
      return { outcome: "rejected", reason: decision.reason }
    }

    if (decision.decision === "AUTO_APPLY") {
      const deltaPercent = Math.abs((proposedValue - currentValue) / currentValue) * 100
      // Transaction unique + advisory-lock par (patient × param × créneau) : sérialise les auto-applications
      // concurrentes sur le même créneau. Re-évaluation SOUS le lock avec un contexte anti-cliquet FRAIS →
      // ferme le TOCTOU C7 (un apply concurrent committé pendant notre 1re évaluation est désormais visible ;
      // pas de duplication de règle — on rejoue l'enveloppe). Event + apply + audit commitent atomiquement.
      const lockKey = `autoapply:${patientId}:${parameterType}:${slotKey}`
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`
        // Re-lecture via `tx` (pas le client global) : reste dans la transaction/le lock, sans prélever de
        // connexions supplémentaires sur le pool (anti-starvation) ; sous READ COMMITTED voit les commits concurrents.
        const fresh = await buildEnvelopeContext(patientId, parameterType, slotKey, ketoneModerateThreshold, now, windowDays, tx)
        // Re-lecture de l'AUTORITÉ sous le lock (kill-switch × flag × approbation) : une révocation
        // (désactivation ADMIN, downgrade, kill-switch) survenue depuis la 1re évaluation avorte l'apply.
        const [freshPatient, freshApprovals] = await Promise.all([
          tx.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { maturityLevel: true, autoApply: true } }),
          tx.governanceApproval.count({ where: { patientId, enabled: true } }),
        ])
        const freshAuthority = {
          maturityLevel: freshPatient?.maturityLevel ?? patient.maturityLevel,
          autoApply: isAutoApplyGloballyEnabled() && !!freshPatient?.autoApply && freshApprovals > 0,
        }
        const recheck = evaluateAutoApplyEnvelope({ ...evalInput, authority: freshAuthority, glycemia: fresh.glycemia, ratchet: fresh.ratchet })
        if (recheck.decision !== "AUTO_APPLY") {
          // Anti-cliquet basculé (C7) OU autorité révoquée (C1) → on ne double pas / on n'applique pas.
          return { applied: false as const, failedCheck: recheck.decision === "FALLBACK_PROPOSAL" ? recheck.failedCheck : "C7" }
        }
        await tx.autoApplyEvent.create({ data: { patientId, parameterType, slotKey, deltaPercent } })
        await applySlotValue(edit, actorUserId, ctx, tx)
        await auditService.logWithTx(tx, {
          userId: actorUserId,
          action: "AUTO_APPLIED_SETTING",
          resource: "PATIENT",
          resourceId: String(patientId),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          metadata: { patientId, parameterType, slotKey, deltaPercent, globallyEnabled: globalOn },
        })
        return { applied: true as const }
      })
      if (result.applied) return { outcome: "applied" }
      // Perdant de la course anti-cliquet → voie proposition (comme un FALLBACK C7).
      const proposal = await adjustmentService.createProposal(toProposalInput(edit), { userId: actorUserId, role: "patient" }, ctx)
      await auditDecision(patientId, actorUserId, "AUTO_APPLY_FALLBACK", { parameterType, slotKey, failedCheck: result.failedCheck }, ctx)
      return { outcome: "proposal", failedCheck: result.failedCheck, proposalId: proposal.id }
    }

    // FALLBACK_PROPOSAL — la voie médecin (createProposal audite la création).
    const proposal = await adjustmentService.createProposal(toProposalInput(edit), { userId: actorUserId, role: "patient" }, ctx)
    await auditDecision(patientId, actorUserId, "AUTO_APPLY_FALLBACK", { parameterType, slotKey, failedCheck: decision.failedCheck }, ctx)
    return { outcome: "proposal", failedCheck: decision.failedCheck, proposalId: proposal.id }
  },
}
