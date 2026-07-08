/**
 * US-2657 (slice C) — Service de **gouvernance de l'auto-application experte** (frontière MDR).
 *
 * Poser `Patient.autoApply = true` est un **acte de gouvernance** (décision qualité/réglementaire),
 * pas un acte clinique : réservé au rôle ADMIN (garde à la route) et **conditionné à un artefact
 * `GovernanceApproval`** (référence de décision + lien DPIA) créé dans la même transaction. La
 * **désactivation** (kill direction) est toujours permise, sans approbation (fail-safe). Le flag reste
 * de plus **subordonné au kill-switch global** `AUTO_APPLY_GLOBALLY_ENABLED` (lu par le harnais, slice C2).
 *
 * Tout est audité (`UPDATE PATIENT`, `from → to`, sans PHI).
 */
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "@/lib/services/audit.service"

export type AutoApplyApproval = { reference: string; dpiaRef?: string | null }

export const governanceService = {
  /**
   * Active/désactive l'auto-application experte d'un patient.
   * @param patientId Patient cible (déjà autorisé par la route).
   * @param enabled Cible du flag.
   * @param approval Artefact de gouvernance — **obligatoire pour activer** (`reference` non vide) ; ignoré à la désactivation.
   * @param adminUserId ADMIN acteur.
   * @param ctx Contexte requête (audit).
   * @throws `patientNotFound` si absent/soft-deleted ; `approvalRequired` si activation sans référence.
   */
  async setAutoApply(
    patientId: number,
    enabled: boolean,
    approval: AutoApplyApproval | null,
    adminUserId: number,
    ctx?: AuditContext,
  ) {
    if (enabled && (!approval || approval.reference.trim() === "")) {
      throw new Error("approvalRequired") // fail-closed : jamais d'activation sans artefact de gouvernance
    }

    return prisma.$transaction(async (tx) => {
      const before = await tx.patient.findFirst({
        where: { id: patientId, deletedAt: null },
        select: { autoApply: true },
      })
      if (!before) throw new Error("patientNotFound")
      if (before.autoApply === enabled) return { autoApply: enabled, changed: false }

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
      await tx.patient.update({ where: { id: patientId }, data: { autoApply: enabled } })
      await auditService.logWithTx(tx, {
        userId: adminUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: {
          patientId,
          kind: "autoApplyChanged",
          from: before.autoApply,
          to: enabled,
          ...(enabled && approval ? { reference: approval.reference, dpiaRef: approval.dpiaRef ?? null } : {}),
        },
      })
      return { autoApply: enabled, changed: true }
    })
  },
}
