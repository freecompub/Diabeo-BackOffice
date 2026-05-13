/**
 * @module patient-referent.service
 * @description US-2021 (transfert référent) + US-2028 (multi-praticiens vue).
 *
 * Sécurité (post-review PR #389):
 *  - C3 : le transfert n'est autorisé qu'à l'ADMIN, au référent courant, ou
 *    au médecin cible (auto-acceptation). Empêche le "vol de patient" :
 *    aucun DOCTOR tiers du même cabinet ne peut hijack le slot.
 *  - H7 : tous les services gardent `patient.deletedAt: null` au layer DB.
 *  - M3 : la vérification d'éligibilité tourne dans la même transaction
 *    `Serializable` que l'upsert (élimine le TOCTOU sur PatientService).
 *  - M11 : type de retour explicite (proId/serviceId non-null par construction).
 *  - Low : `getReferentsView` n'expose `userId` que pour le référent primaire
 *    (data-minimization vis-à-vis des autres membres).
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import {
  MemberNotEligibleError,
  ReferentTransferForbiddenError,
} from "./patient-tag.errors"

export type ReferentRole = "primary" | "service-member"

export type ReferentEntry = {
  memberId: number
  /** Only populated for `role: "primary"` (data-minimization for peers). */
  userId: number | null
  serviceId: number
  serviceName: string
  role: ReferentRole
}

export type TransferReferentResult = {
  id: number
  proId: number
  serviceId: number
}

export const patientReferentService = {
  async getReferentsView(
    patientId: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<ReferentEntry[]> {
    const links = await prisma.patientService.findMany({
      where: { patientId, patient: { deletedAt: null } },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            members: { select: { id: true, userId: true } },
          },
        },
      },
    })
    const primary = await prisma.patientReferent.findFirst({
      where: { patientId, patient: { deletedAt: null } },
      select: { proId: true },
    })

    const entries: ReferentEntry[] = []
    const seen = new Set<string>()
    for (const link of links) {
      for (const m of link.service.members) {
        const key = `${m.id}:${link.service.id}`
        if (seen.has(key)) continue
        seen.add(key)
        const isPrimary = primary?.proId === m.id
        entries.push({
          memberId: m.id,
          userId: isPrimary ? m.userId : null,
          serviceId: link.service.id,
          serviceName: link.service.name,
          role: isPrimary ? "primary" : "service-member",
        })
      }
    }

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "REFERENT",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { patientId, count: entries.length },
    })
    return entries
  },

  /**
   * Transfer the primary referent. Authorization rules (C3 fix):
   *  - ADMIN: always allowed.
   *  - Current referent (auditUserId === current primary's user): allowed.
   *  - Target pro (auditUserId === newMember.userId): allowed (self-claim).
   *  - Any other DOCTOR member of the patient's services: REJECTED.
   */
  async transferReferent(
    patientId: number,
    newProMemberId: number,
    actingUserId: number,
    isAdmin: boolean,
    ctx?: AuditContext,
  ): Promise<TransferReferentResult> {
    return prisma.$transaction(
      async (tx) => {
        // Patient must exist + be alive.
        const patient = await tx.patient.findFirst({
          where: { id: patientId, deletedAt: null },
          select: { id: true },
        })
        if (!patient) throw new MemberNotEligibleError()

        // Eligibility: the new member is linked to the patient via a service
        // membership (any service the patient belongs to).
        const newMember = await tx.healthcareMember.findFirst({
          where: {
            id: newProMemberId,
            service: { patientServices: { some: { patientId } } },
          },
          select: { id: true, userId: true, serviceId: true },
        })
        if (!newMember) throw new MemberNotEligibleError()

        // Existing referent (may be null).
        const existing = await tx.patientReferent.findUnique({
          where: { patientId },
          select: { proId: true, serviceId: true, pro: { select: { userId: true } } },
        })

        // Authorization (C3 fix).
        const callerIsCurrentReferent =
          existing?.pro?.userId === actingUserId && actingUserId !== null
        const callerIsTarget = newMember.userId === actingUserId
        if (!isAdmin && !callerIsCurrentReferent && !callerIsTarget) {
          throw new ReferentTransferForbiddenError()
        }

        if (newMember.serviceId === null) {
          // Shouldn't happen — HealthcareMember.serviceId is non-null in
          // practice — but the schema lets it through. Defensive.
          throw new MemberNotEligibleError()
        }
        const newServiceId: number = newMember.serviceId

        const updated = await tx.patientReferent.upsert({
          where: { patientId },
          create: { patientId, proId: newProMemberId, serviceId: newServiceId },
          update: { proId: newProMemberId, serviceId: newServiceId },
        })

        await auditService.logWithTx(tx, {
          userId: actingUserId,
          action: "UPDATE",
          resource: "REFERENT",
          resourceId: String(updated.id),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          metadata: {
            patientId,
            previousProId: existing?.proId ?? null,
            previousReferentUserId: existing?.pro?.userId ?? null,
            newProId: newProMemberId,
            newReferentUserId: newMember.userId,
            authorizedBy: isAdmin
              ? "admin"
              : callerIsCurrentReferent
                ? "currentReferent"
                : "selfClaim",
          },
        })

        // proId/serviceId are guaranteed non-null by the upsert payload.
        return {
          id: updated.id,
          proId: newProMemberId,
          serviceId: newServiceId,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  },
}
