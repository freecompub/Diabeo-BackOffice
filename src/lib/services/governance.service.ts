/**
 * US-2657 (slice C) — Service de **gouvernance de l'auto-application experte** (frontière MDR).
 *
 * Poser `Patient.autoApply = true` est un **acte de GOUVERNANCE PLATEFORME** (décision qualité/réglementaire
 * du fabricant : DPO + RSSI + responsable MDR, signataires DPIA), pas un acte clinique. Porté par le rôle
 * **ADMIN** (autorité plateforme, garde à la route ; ADR US-2657). Le médecin (hôpital ou indépendant) est
 * côté *demande*, jamais *octroi* → la séparation des devoirs vient du niveau plateforme (pas de garde
 * « quatre yeux » locale). **Conditionné (fail-closed)** à : `maturityLevel === EXPERT`, une `reference` de
 * décision ET une `dpiaRef` (DPIA = dépendance dure MDR/RGPD Art. 35), matérialisées par une
 * `GovernanceApproval` créée dans la même transaction. La **désactivation** (kill direction) est toujours
 * permise, sans approbation (fail-safe). Le flag reste **subordonné au kill-switch global**
 * `AUTO_APPLY_GLOBALLY_ENABLED` (lu par le harnais, slice C2).
 *
 * Tout est audité (`AUTO_APPLY_FLAG_CHANGED`, `from → to`, sans PHI).
 */
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "@/lib/services/audit.service"

export type AutoApplyApproval = { reference: string; dpiaRef?: string | null }

export const governanceService = {
  /**
   * Active/désactive l'auto-application experte d'un patient.
   * @param patientId Patient cible (déjà autorisé par la route).
   * @param enabled Cible du flag.
   * @param approval Artefact de gouvernance — **obligatoire pour activer** (`reference` ET `dpiaRef` non vides) ; ignoré à la désactivation.
   * @param adminUserId ADMIN acteur (autorité gouvernance plateforme).
   * @param ctx Contexte requête (audit).
   * @throws `patientNotFound` si absent/soft-deleted ; `approvalRequired` (référence manquante) ;
   *   `dpiaRequired` (DPIA manquante) ; `maturityNotExpert` (activation d'un patient non EXPERT). Tous fail-closed.
   */
  async setAutoApply(
    patientId: number,
    enabled: boolean,
    approval: AutoApplyApproval | null,
    adminUserId: number,
    ctx?: AuditContext,
  ) {
    if (enabled) {
      // Fail-closed : jamais d'activation sans artefact de gouvernance COMPLET.
      if (!approval || approval.reference.trim() === "") throw new Error("approvalRequired")
      // DPIA = dépendance dure MDR/RGPD Art. 35 (matérialisée en code, pas seulement procédurale).
      if (!approval.dpiaRef || approval.dpiaRef.trim() === "") throw new Error("dpiaRequired")
    }

    return prisma.$transaction(async (tx) => {
      const before = await tx.patient.findFirst({
        where: { id: patientId, deletedAt: null },
        select: { autoApply: true, maturityLevel: true },
      })
      if (!before) throw new Error("patientNotFound")
      // Pré-condition d'activation : le patient doit être EXPERT (la maturité est posée par le DOCTOR,
      // acte clinique distinct). Fail-closed : refus de l'acte de gouvernance sur un patient non éligible.
      if (enabled && before.maturityLevel !== "EXPERT") throw new Error("maturityNotExpert")
      const changed = before.autoApply !== enabled

      // Activation : on enregistre TOUJOURS l'artefact de gouvernance — y compris une re-approbation
      // d'un patient déjà activé (chaque décision de gouvernance doit être tracée), même si le flag
      // ne change pas. Une désactivation idempotente (déjà OFF) reste un no-op complet.
      if (enabled && approval) {
        await tx.governanceApproval.create({
          data: {
            patientId,
            approvedById: adminUserId,
            reference: approval.reference,
            dpiaRef: approval.dpiaRef ?? null,
            enabled: true,
          },
        })
      }
      if (changed) {
        await tx.patient.update({ where: { id: patientId }, data: { autoApply: enabled } })
      }
      // Audit dès qu'une décision de gouvernance a eu lieu (approbation enregistrée OU flag modifié).
      if ((enabled && approval) || changed) {
        await auditService.logWithTx(tx, {
          userId: adminUserId,
          action: "AUTO_APPLY_FLAG_CHANGED",
          resource: "PATIENT",
          resourceId: String(patientId),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          metadata: {
            patientId,
            from: before.autoApply,
            to: enabled,
            ...(enabled && approval ? { reference: approval.reference, dpiaRef: approval.dpiaRef } : {}),
          },
        })
      }
      return { autoApply: enabled, changed }
    })
  },
}
