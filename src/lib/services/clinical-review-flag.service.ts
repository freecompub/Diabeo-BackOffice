/**
 * clinicalReviewFlagService — flags d'orientation clinique (US-2646 / US-2651 mode c).
 *
 * Un `ClinicalReviewFlag` est un objet **DISTINCT** d'`AdjustmentProposal` : il ne porte
 * **JAMAIS** de posologie (frontière dispositif médical / IEC 62304). Il sert à **remonter
 * une intention/observation à l'équipe soignante** (« à revoir en consultation », HbA1c
 * périmée, TIR sous cible, observance) sans jamais recommander de dose.
 *
 * Cas d'usage principal (US-2651) : un patient NON INSULINÉ qui tente une proposition de dose
 * est refusé (`nonInsulinNoDose`, frontière MDR) — mais son intention ne doit pas être un
 * cul-de-sac silencieux : on lève un flag `reviewInConsultation` pour le soignant.
 *
 * @see prisma/schema.prisma model ClinicalReviewFlag
 */

import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "@/lib/services/audit.service"
import type { ClinicalReviewFlagType } from "@prisma/client"

export const clinicalReviewFlagService = {
  /**
   * Lève un flag d'orientation pour un patient, de manière **IDEMPOTENTE** : si un flag
   * `open` du même `type` existe déjà pour ce patient, aucun nouveau flag n'est créé
   * (anti-spam — un patient qui ré-essaie ne multiplie pas les flags). Seule la CRÉATION est
   * auditée ; le skip idempotent (simple sonde d'existence non-PHI) n'est pas tracé.
   *
   * @param patientId Dossier concerné (déjà résolu/autorisé par l'appelant).
   * @param type Type de flag (`reviewInConsultation`, `hba1cStale`, `tirBelowTarget`, `observance`).
   * @param createdBy Utilisateur à l'origine (null = généré par algorithme).
   * @param ctx Contexte requête (audit).
   * @returns `{ flagId, created }` — `created=false` si un flag ouvert existait déjà.
   */
  async raise(
    patientId: number,
    type: ClinicalReviewFlagType,
    createdBy: number | null,
    ctx?: AuditContext,
  ): Promise<{ flagId: string; created: boolean }> {
    const existing = await prisma.clinicalReviewFlag.findFirst({
      where: { patientId, type, status: "open" },
      select: { id: true },
    })
    if (existing) return { flagId: existing.id, created: false }

    const flag = await prisma.clinicalReviewFlag.create({
      data: { patientId, type, createdBy },
      select: { id: true },
    })
    await auditService.log({
      userId: createdBy ?? null, // FK-safe : `null` = acteur système/algorithme (jamais 0, cf. audit.service)
      action: "CREATE",
      resource: "CLINICAL_REVIEW_FLAG",
      resourceId: flag.id,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, type }, // jamais de PHI/posologie
    })
    return { flagId: flag.id, created: true }
  },
}
