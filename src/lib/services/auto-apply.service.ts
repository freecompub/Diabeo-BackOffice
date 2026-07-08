/**
 * US-2657 (slice C2b) — **Harnais gouverné de l'auto-application experte** (frontière MDR).
 *
 * Point d'entrée où l'enveloppe est ENFIN appelée. Orchestre : **double verrou** (kill-switch global ×
 * flag patient) → assemblage du contexte (`buildEnvelopeContext`) → décision PURE
 * (`evaluateAutoApplyEnvelope`) → **dispatch** :
 *  - `AUTO_APPLY` → applique la valeur du créneau (`updateIsf/updateIcr/updatePumpSlot`, anti-IDOR +
 *    audit hérités) + enregistre l'`AutoApplyEvent` (anti-cliquet) + audite la décision ;
 *  - `FALLBACK_PROPOSAL` → crée une `AdjustmentProposal` (reason `patientRequested`) — voie médecin ;
 *  - `HARD_REJECT` → audite le rejet, n'applique rien.
 *
 * **Périmètre** : paramètres à créneau ISF/ICR/basal (ceux du dialogue d'édition de créneaux). La dose
 * fixe (édition par moment) suit un autre chemin → non supporté ici (rejeté par le type).
 *
 * **Autorité** : l'appelant (route C3) est responsable de l'authz (rôle/portefeuille) ; ce service
 * reçoit un `patientId` déjà autorisé et audite la décision. `now` injecté (pas d'horloge cachée).
 */
import type { AdjustableParameter, AdjustmentReason } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { decimalToNumber } from "@/lib/db/decimal"
import { isAutoApplyGloballyEnabled } from "@/lib/env"
import { KETONE_DEFAULTS } from "@/lib/services/ketone-threshold.service"
import { buildEnvelopeContext } from "@/lib/insulin/auto-apply-context"
import { evaluateAutoApplyEnvelope } from "@/lib/insulin/auto-apply-envelope"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { adjustmentService, type CreateProposalInput } from "@/lib/services/adjustment.service"
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
  | { outcome: "proposal"; failedCheck: string; proposalId: string }
  | { outcome: "rejected"; reason: string }

/** Applique la nouvelle valeur du créneau via la primitive scopée (anti-IDOR + audit hérités). */
async function applySlotValue(edit: ExpertSlotEdit, actorUserId: number, ctx?: AuditContext): Promise<void> {
  const { slotId, proposedValue, patientId } = edit
  switch (edit.parameterType) {
    case "insulinSensitivityFactor":
      await insulinTherapyService.updateIsf(slotId, proposedValue, actorUserId, patientId, ctx)
      return
    case "insulinToCarbRatio":
      await insulinTherapyService.updateIcr(slotId, proposedValue, actorUserId, patientId, ctx)
      return
    case "basalRate":
      await insulinTherapyService.updatePumpSlot(slotId, proposedValue, actorUserId, patientId, ctx)
      return
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

/** Audit de la DÉCISION d'enveloppe (trail gouvernance/MDR, sans PHI). */
async function auditDecision(
  patientId: number,
  actorUserId: number,
  meta: Record<string, unknown>,
  ctx?: AuditContext,
): Promise<void> {
  await auditService.log({
    userId: actorUserId,
    action: "UPDATE",
    resource: "PATIENT",
    resourceId: String(patientId),
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
    metadata: { patientId, kind: "autoApplyDecision", ...meta },
  })
}

export const autoApplyService = {
  /**
   * Évalue et applique/propose/rejette une édition de créneau d'un patient EXPERT, sous gouvernance.
   * @param edit Édition de créneau (déjà validée/autorisée par l'appelant).
   * @param actorUserId Acteur (le patient, pour la proposition et l'audit).
   * @param now Instant de référence (injecté).
   * @param ctx Contexte requête (audit).
   * @throws `patientNotFound` si le patient est absent/soft-deleted.
   */
  async applyExpertEditGoverned(
    edit: ExpertSlotEdit,
    actorUserId: number,
    now: Date,
    ctx?: AuditContext,
  ): Promise<GovernedOutcome> {
    const { patientId, parameterType, startHour, endHour, currentValue, proposedValue, changeKind, isfUnit, windowDays } = edit

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { maturityLevel: true, autoApply: true },
    })
    if (!patient) throw new Error("patientNotFound")

    const kt = await prisma.ketoneThreshold.findUnique({ where: { patientId }, select: { moderateThreshold: true } })
    const ketoneModerateThreshold = kt ? decimalToNumber(kt.moderateThreshold) : KETONE_DEFAULTS.moderateThreshold

    // Double verrou : le kill-switch global force `autoApply = false` (→ enveloppe C1 → proposition).
    const globalOn = isAutoApplyGloballyEnabled()
    const slotKey = `${startHour}-${endHour}`

    const context = await buildEnvelopeContext(patientId, parameterType, slotKey, ketoneModerateThreshold, now, windowDays)

    const decision = evaluateAutoApplyEnvelope({
      authority: { maturityLevel: patient.maturityLevel, autoApply: globalOn && patient.autoApply },
      change: { parameterType, changeKind, currentValue, proposedValue, isfUnit },
      glycemia: context.glycemia,
      ratchet: context.ratchet,
    })

    if (decision.decision === "HARD_REJECT") {
      await auditDecision(patientId, actorUserId, { outcome: "rejected", parameterType, slotKey, reason: decision.reason }, ctx)
      return { outcome: "rejected", reason: decision.reason }
    }

    if (decision.decision === "AUTO_APPLY") {
      const deltaPercent = Math.abs((proposedValue - currentValue) / currentValue) * 100
      // Enregistré AVANT l'application : sur un échec rare d'apply, l'anti-cliquet SUR-compte
      // (plus strict = fail-safe), jamais l'inverse (un sous-comptage relâcherait le garde-fou C7).
      await prisma.autoApplyEvent.create({ data: { patientId, parameterType, slotKey, deltaPercent } })
      await applySlotValue(edit, actorUserId, ctx)
      await auditDecision(patientId, actorUserId, { outcome: "applied", parameterType, slotKey, deltaPercent }, ctx)
      return { outcome: "applied" }
    }

    // FALLBACK_PROPOSAL — la voie médecin (createProposal audite la création).
    const proposal = await adjustmentService.createProposal(toProposalInput(edit), { userId: actorUserId, role: "patient" }, ctx)
    await auditDecision(patientId, actorUserId, { outcome: "proposal", parameterType, slotKey, failedCheck: decision.failedCheck }, ctx)
    return { outcome: "proposal", failedCheck: decision.failedCheck, proposalId: proposal.id }
  },
}
