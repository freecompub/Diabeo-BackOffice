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
import type { AdjustableParameter, AdjustmentReason, Pathology, Prisma } from "@prisma/client"
import { prisma, type PrismaClientOrTx } from "@/lib/db/client"
import { decimalToNumber } from "@/lib/db/decimal"
import { isAutoApplyGloballyEnabled } from "@/lib/env"
import { KETONE_DEFAULTS } from "@/lib/services/ketone-threshold.service"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import { buildEnvelopeContext } from "@/lib/insulin/auto-apply-context"
import { evaluateAutoApplyEnvelope } from "@/lib/insulin/auto-apply-envelope"
import { tryLockInsulinSlots } from "@/lib/insulin/slot-lock"
import { deriveRiskDirection } from "@/lib/insulin/risk-direction"
import { resolvePatientCapTier, type PatientCapTier } from "@/lib/insulin/patient-change-cap"
import { insulinTherapyService, assertValidSlotSet } from "@/lib/services/insulin-therapy.service"
import { adjustmentService, type CreateProposalInput } from "@/lib/services/adjustment.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { slotSetProposalService, REPLACE_KEY, type ProposedSlot, type SlotSetParam } from "@/lib/services/slot-set-proposal.service"
import { auditService, type AuditContext } from "@/lib/services/audit.service"

/** Égalité de valeurs cliniques (Decimal→number) avec tolérance — convention repo (évite le churn no-op). */
const sameValue = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9

/**
 * US-2652 — Tier de cap patient pour l'enveloppe C3 (delta absolu `min(%, abs_tier)` = cap patient). Résolu
 * serveur : `pathology` + grossesse (`pregnancyMode || GD`) + mode pédiatrique. Cascade « le plus strict gagne ».
 */
async function resolveAutoApplyTier(patientId: number, pathology: Pathology, pregnancyMode: boolean): Promise<PatientCapTier> {
  const pediatric = await prisma.configVersion.findFirst({
    where: { patientId, configType: "pediatric_mode", status: "active" },
    select: { id: true },
  })
  return resolvePatientCapTier(pathology, pediatric != null, pregnancyMode || pathology === "GD")
}

/**
 * C3b (US-2657) — Cap d'AMPLITUDE cumulée CO-DIRECTIONNELLE d'un groupe (pure). Somme les `|Δ%|` des
 * créneaux modifiés PAR DIRECTION de risque (`deriveRiskDirection`) : « plus d'insuline » (hypo) et « moins »
 * (hyper) sommés SÉPARÉMENT — jamais additionnés (une redistribution nuit≠midi n'est pas un risque cumulé).
 * Seuils ASYMÉTRIQUES (le risque hypo est aigu, l'hyper lent et déjà gardé par C6b). `true` = dépassement
 * → tout le groupe doit partir en proposition (fail-closed). Chaque `current` doit être non nul (ratios > 0).
 */
export function exceedsGroupCumulativeAmplitude(
  changed: Array<{ startHour: number; endHour: number; value: number }>,
  curByKey: Map<string, number>,
  parameterType: AdjustableParameter,
): boolean {
  let sumHypo = 0
  let sumHyper = 0
  for (const s of changed) {
    const cur = curByKey.get(`${s.startHour}-${s.endHour}`)
    if (cur === undefined || cur === 0) continue
    const deltaPct = Math.abs((s.value - cur) / cur) * 100
    const dir = deriveRiskDirection(parameterType, cur, s.value)
    if (dir === "hypo") sumHypo += deltaPct
    else if (dir === "hyper") sumHyper += deltaPct
  }
  // Tolérance FP (ex. 2×10 % = 20.000…018) : un cumul EXACTEMENT au seuil ne déclenche pas (le seuil est
  // inclusif — « ≤ seuil » auto-applicable, cohérent avec les vecteurs cliniques 15 %/20 %).
  const EPS = 1e-9
  return (
    sumHypo > CLINICAL_BOUNDS.AUTO_APPLY_MAX_GROUP_CUMULATIVE_INCREASE_PERCENT + EPS ||
    sumHyper > CLINICAL_BOUNDS.AUTO_APPLY_MAX_GROUP_CUMULATIVE_DECREASE_PERCENT + EPS
  )
}

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
 * US-2657 (slice C3b) — Édition de GROUPE d'un jeu de créneaux ISF/ICR (le patient soumet le jeu complet).
 * `parameterType` mono-paramètre (ISF **ou** ICR — jamais mixte). `proposedSlots` = disposition complète.
 */
export type ExpertGroupEdit = {
  patientId: number
  parameterType: SlotSetParam
  proposedSlots: ProposedSlot[]
  windowDays?: number
}


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

/**
 * Lit le jeu de créneaux courant (valeur en g/L ISF / g/U ICR) scopé patient — pour dériver changeKind + Δ.
 * `client` optionnel : la relecture SOUS le lock (anti lost-update B1) passe le `tx` englobant.
 */
async function readCurrentSlots(
  param: "isf" | "icr",
  patientId: number,
  client: PrismaClientOrTx = prisma,
): Promise<Array<{ startHour: number; endHour: number; value: number }>> {
  if (param === "isf") {
    const rows = await client.insulinSensitivityFactor.findMany({
      where: { settings: { patientId } },
      select: { startHour: true, endHour: true, sensitivityFactorGl: true },
    })
    return rows.map((r) => ({ startHour: r.startHour, endHour: r.endHour, value: decimalToNumber(r.sensitivityFactorGl) }))
  }
  const rows = await client.carbRatio.findMany({
    where: { settings: { patientId } },
    select: { startHour: true, endHour: true, gramsPerUnit: true },
  })
  return rows.map((r) => ({ startHour: r.startHour, endHour: r.endHour, value: decimalToNumber(r.gramsPerUnit) }))
}

/** Vrai si deux jeux de créneaux sont identiques (frontières + valeurs à tolérance) — détection baseline bougé. */
function slotSetsEqual(
  a: Array<{ startHour: number; endHour: number; value: number }>,
  b: Array<{ startHour: number; endHour: number; value: number }>,
): boolean {
  if (a.length !== b.length) return false
  const bByKey = new Map(b.map((s) => [`${s.startHour}-${s.endHour}`, s.value]))
  return a.every((s) => {
    const v = bByKey.get(`${s.startHour}-${s.endHour}`)
    return v !== undefined && sameValue(v, s.value)
  })
}

/** Paramètre unitaire → clé de verrou unifiée (partagée avec le groupe et les écritures DOCTOR directes). */
const SLOT_LOCK_PARAM: Record<SlotParam, "isf" | "icr" | "basal"> = {
  insulinSensitivityFactor: "isf",
  insulinToCarbRatio: "icr",
  basalRate: "basal",
}

/** Lit la valeur COURANTE d'un créneau (scopé patient) — pour le garde `baselineMoved` unitaire sous lock. */
async function readSlotValue(
  tx: Prisma.TransactionClient,
  parameterType: SlotParam,
  slotId: string,
  patientId: number,
): Promise<number | null> {
  switch (parameterType) {
    case "insulinSensitivityFactor": {
      const r = await tx.insulinSensitivityFactor.findFirst({ where: { id: slotId, settings: { patientId } }, select: { sensitivityFactorGl: true } })
      return r ? decimalToNumber(r.sensitivityFactorGl) : null
    }
    case "insulinToCarbRatio": {
      const r = await tx.carbRatio.findFirst({ where: { id: slotId, settings: { patientId } }, select: { gramsPerUnit: true } })
      return r ? decimalToNumber(r.gramsPerUnit) : null
    }
    case "basalRate": {
      const r = await tx.pumpBasalSlot.findFirst({ where: { id: slotId, basalConfig: { settings: { patientId } } }, select: { rate: true } })
      return r ? decimalToNumber(r.rate) : null
    }
  }
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
      select: { maturityLevel: true, autoApply: true, pathology: true, pregnancyMode: true },
    })
    if (!patient) throw new Error("patientNotFound")
    const tier = await resolveAutoApplyTier(patientId, patient.pathology, patient.pregnancyMode)

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
      change: { parameterType, changeKind, currentValue, proposedValue, isfUnit, tier },
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
      // Transaction unique + VERROU UNIFIÉ `(patient × param)` — exclut aussi le chemin groupé et les
      // écritures DOCTOR directes (anti lost-update B1). Sous le lock : baseline RELU (garde `baselineMoved`),
      // autorité + anti-cliquet ré-évalués (contexte frais) → ferme le TOCTOU C7. Event + apply + audit atomiques.
      const result = await prisma.$transaction(async (tx) => {
        // Verrou non bloquant : mutation concurrente en cours → fail-closed → proposition (pas d'attente).
        if (!(await tryLockInsulinSlots(tx, patientId, SLOT_LOCK_PARAM[parameterType]))) return { applied: false as const, failedCheck: "busy" }
        // Baseline RELU sous lock : si la valeur courante du créneau a bougé depuis l'évaluation (édition
        // médecin/groupe concurrente), ne pas appliquer sur une base périmée → fail-closed → proposition.
        const liveValue = await readSlotValue(tx, parameterType, edit.slotId, patientId)
        if (liveValue === null || !sameValue(liveValue, currentValue)) {
          return { applied: false as const, failedCheck: "baselineMoved" }
        }
        // Re-lecture via `tx` : reste dans la transaction/le lock, sans connexion pool supplémentaire.
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

  /**
   * US-2657 (slice C3b) — **Orchestrateur GROUPÉ** `applyExpertGroupGoverned`. Un patient EXPERT soumet un
   * JEU de créneaux ISF/ICR complet. Décision **tout-ou-rien au niveau groupe** (jamais d'application
   * partielle — invariant spec §4) :
   *  - valeur hors bornes/couverture invalide → **rejet dur à la saisie** (`assertValidSlotSet` lève) ;
   *  - **restructuration** (heures ajoutées/supprimées/déplacées, `changeKind` dérivé SERVEUR) → proposition groupée ;
   *  - hors triple verrou (C1) → proposition groupée ;
   *  - plus de `AUTO_APPLY_MAX_GROUP_SLOTS` créneaux modifiés → proposition groupée (attribuabilité / MDR) ;
   *  - un seul créneau modifié ≠ AUTO_APPLY (enveloppe) → **groupe entier** en proposition ;
   *  - **tous AUTO_APPLY** → application ATOMIQUE du jeu complet (`replaceSlotSet`) + `AutoApplyEvent` par
   *    créneau + audit, sous advisory-lock (ré-évaluation sous lock, anti-TOCTOU).
   * Le fallback est TOUJOURS une `SlotSetProposal` groupée (jamais d'`AdjustmentProposal` par-valeur, ADR #23).
   * @throws patientNotFound | emptySlotSet | valueOutOfBounds | slotOverlap | slotGap | zeroDurationSlot
   */
  async applyExpertGroupGoverned(
    edit: ExpertGroupEdit,
    actorUserId: number,
    now: Date,
    ctx?: AuditContext,
  ): Promise<GovernedOutcome> {
    const { patientId, parameterType, proposedSlots, windowDays } = edit
    const param = REPLACE_KEY[parameterType]

    // 1. Rejet dur à la saisie : bornes cliniques + couverture (no-gap/no-overlap). Lève si invalide.
    assertValidSlotSet(param, proposedSlots)

    // 2. Patient existant / non soft-deleted.
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { maturityLevel: true, autoApply: true, pathology: true, pregnancyMode: true },
    })
    if (!patient) throw new Error("patientNotFound")
    const tier = await resolveAutoApplyTier(patientId, patient.pathology, patient.pregnancyMode)

    // 3. Frontière MDR — jamais de dose auto pour un patient non insuliné (re-vérifiée SOUS le lock en 8).
    const { mode } = await treatmentModeService.resolveTreatmentMode(patientId)
    if (mode === "nonInsulin") {
      await auditDecision(patientId, actorUserId, "AUTO_APPLY_REJECTED", { parameterType, reason: "nonInsulinNoDose", group: true }, ctx)
      return { outcome: "rejected", reason: "nonInsulinNoDose" }
    }

    // 4. Instantané PRÉ-LOCK (décisions bon marché : structurel / cap / no-op). L'apply RELIT sous le lock.
    const preLock = await readCurrentSlots(param, patientId)
    const curByKey0 = new Map(preLock.map((s) => [`${s.startHour}-${s.endHour}`, s.value]))
    const propKeys = proposedSlots.map((s) => `${s.startHour}-${s.endHour}`)
    const structural = propKeys.length !== curByKey0.size || propKeys.some((k) => !curByKey0.has(k))
    const changed0 = structural
      ? proposedSlots
      : proposedSlots.filter((s) => !sameValue(curByKey0.get(`${s.startHour}-${s.endHour}`)!, s.value))

    // Voie proposition GROUPÉE (jamais d'AdjustmentProposal par-valeur — ADR #23).
    const propose = async (failedCheck: string, changedCount: number): Promise<GovernedOutcome> => {
      const p = await slotSetProposalService.createSetProposal(patientId, parameterType, proposedSlots, actorUserId, ctx)
      await auditDecision(patientId, actorUserId, "AUTO_APPLY_FALLBACK", { parameterType, failedCheck, changedSlots: changedCount, structural, group: true }, ctx)
      return { outcome: "proposal", failedCheck, proposalId: p.id }
    }

    // 5. Restructuration → jamais auto-appliquée (C2). / Aucune valeur modifiée → no-op.
    if (structural) return propose("C2", 0)
    if (changed0.length === 0) return { outcome: "noop" }

    // 6. Triple verrou (kill-switch × flag × existence d'approbation).
    const globalOn = isAutoApplyGloballyEnabled()
    const hasGovernanceApproval = (await prisma.governanceApproval.count({ where: { patientId, enabled: true } })) > 0
    if (!(globalOn && patient.autoApply && hasGovernanceApproval)) return propose("C1", changed0.length)

    // 7. Cap GROUPE : au-delà de N créneaux modifiés → re-titration = revue médecin (attribuabilité / MDR).
    if (changed0.length > CLINICAL_BOUNDS.AUTO_APPLY_MAX_GROUP_SLOTS) return propose("groupSlots", changed0.length)

    // 7b. Cap d'AMPLITUDE cumulée co-directionnelle (C3b) — routage bon marché pré-lock ; re-vérifié SOUS le
    //     lock sur le `changed` autoritaire (anti-TOCTOU). Deux créneaux même sens empilent leur effet.
    if (exceedsGroupCumulativeAmplitude(changed0, curByKey0, parameterType)) return propose("groupCumulative", changed0.length)

    const kt = await prisma.ketoneThreshold.findUnique({ where: { patientId }, select: { moderateThreshold: true } })
    const ketoneModerateThreshold = kt ? decimalToNumber(kt.moderateThreshold) : KETONE_DEFAULTS.moderateThreshold

    // 8. Application TOUT-OU-RIEN sous VERROU UNIFIÉ `(patient × param)` — exclut AUSSI l'auto-application
    //    unitaire et les écritures DOCTOR directes. On RELIT le baseline SOUS le lock : si la config a bougé
    //    depuis l'instantané pré-lock (édition médecin/unitaire concurrente) → fail-closed → proposition
    //    (jamais écraser une décision plus récente — anti lost-update B1). Puis re-vérif MDR + autorité +
    //    ré-éval enveloppe par créneau (≤ N) ; un seul ≠ AUTO_APPLY → tout le groupe en proposition.
    const result = await prisma.$transaction(
      async (
        tx,
      ): Promise<
        | { kind: "applied" }
        | { kind: "propose"; failedCheck: string; changedCount: number }
        | { kind: "reject"; reason: string }
      > => {
        // Verrou non bloquant : une mutation concurrente en cours → on n'attend pas, fail-closed → proposition.
        if (!(await tryLockInsulinSlots(tx, patientId, param))) return { kind: "propose", failedCheck: "busy", changedCount: changed0.length }

        // Baseline FRAIS sous lock → divergence = fail-closed (anti lost-update).
        const fresh = await readCurrentSlots(param, patientId, tx)
        if (!slotSetsEqual(fresh, preLock)) return { kind: "propose", failedCheck: "baselineMoved", changedCount: changed0.length }
        const curByKey = new Map(fresh.map((s) => [`${s.startHour}-${s.endHour}`, s.value]))
        const changed = proposedSlots.filter((s) => !sameValue(curByKey.get(`${s.startHour}-${s.endHour}`)!, s.value))
        if (changed.length === 0) return { kind: "propose", failedCheck: "baselineMoved", changedCount: 0 }

        // Frontière MDR re-vérifiée sous lock (bascule concurrente vers non insuliné).
        if ((await treatmentModeService.resolveTreatmentMode(patientId)).mode === "nonInsulin") {
          return { kind: "reject", reason: "nonInsulinNoDose" }
        }

        // Autorité relue sous lock + snapshot gouvernance pour l'audit immuable (attribuabilité MDR).
        const [freshPatient, approval] = await Promise.all([
          tx.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { maturityLevel: true, autoApply: true } }),
          tx.governanceApproval.findFirst({ where: { patientId, enabled: true }, orderBy: { createdAt: "desc" }, select: { id: true, reference: true } }),
        ])
        const authority = {
          maturityLevel: freshPatient?.maturityLevel ?? patient.maturityLevel,
          autoApply: isAutoApplyGloballyEnabled() && !!freshPatient?.autoApply && approval != null,
        }

        for (const s of changed) {
          const slotKey = `${s.startHour}-${s.endHour}`
          const ctxE = await buildEnvelopeContext(patientId, parameterType, slotKey, ketoneModerateThreshold, now, windowDays, tx)
          const decision = evaluateAutoApplyEnvelope({
            authority,
            change: { parameterType, changeKind: "VALUE", currentValue: curByKey.get(slotKey)!, proposedValue: s.value, isfUnit: param === "isf" ? "gl" : undefined, tier },
            glycemia: ctxE.glycemia,
            ratchet: ctxE.ratchet,
          })
          if (decision.decision === "HARD_REJECT") return { kind: "reject", reason: decision.reason }
          if (decision.decision !== "AUTO_APPLY") return { kind: "propose", failedCheck: decision.failedCheck, changedCount: changed.length }
        }

        // Cap d'AMPLITUDE cumulée co-directionnelle (C3b) — vérif AUTORITAIRE dans le chemin d'écriture (sur le
        // `changed` sous lock). Défense en profondeur : le garde `baselineMoved` ci-dessus garantit déjà
        // `fresh === preLock` (donc verdict identique au pré-lock), mais ce re-check tient même si ce garde
        // était un jour affaibli — aucune écriture au-delà de ce point sans repasser le cap.
        if (exceedsGroupCumulativeAmplitude(changed, curByKey, parameterType)) {
          return { kind: "propose", failedCheck: "groupCumulative", changedCount: changed.length }
        }

        // Tous AUTO_APPLY → applique le jeu COMPLET atomiquement + anti-cliquet par créneau + audit.
        await insulinTherapyService.replaceSlotSet(param, patientId, proposedSlots, actorUserId, ctx, tx)
        const slotKeys: string[] = []
        for (const s of changed) {
          const slotKey = `${s.startHour}-${s.endHour}`
          const cur = curByKey.get(slotKey)!
          await tx.autoApplyEvent.create({ data: { patientId, parameterType, slotKey, deltaPercent: Math.abs((s.value - cur) / cur) * 100 } })
          slotKeys.push(slotKey)
        }
        await auditService.logWithTx(tx, {
          userId: actorUserId,
          action: "AUTO_APPLIED_SETTING",
          resource: "PATIENT",
          resourceId: String(patientId),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          // Attribution (créneaux) + preuve de gouvernance figées dans le journal immuable (MDR).
          metadata: { patientId, parameterType, group: true, slotKeys, changedSlots: changed.length, globallyEnabled: globalOn, maturityLevel: authority.maturityLevel, governanceApprovalId: approval?.id ?? null, governanceReference: approval?.reference ?? null },
        })
        return { kind: "applied" }
      },
    )

    if (result.kind === "applied") return { outcome: "applied" }
    if (result.kind === "reject") {
      await auditDecision(patientId, actorUserId, "AUTO_APPLY_REJECTED", { parameterType, reason: result.reason, group: true }, ctx)
      return { outcome: "rejected", reason: result.reason }
    }
    return propose(result.failedCheck, result.changedCount)
  },
}
