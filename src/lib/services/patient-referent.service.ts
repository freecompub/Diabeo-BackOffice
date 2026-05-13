/**
 * @module patient-referent.service
 * @description US-2021 (transfert référent) + US-2028 (multi-praticiens vue).
 *
 * Le `PatientReferent` est 1:1 — un patient n'a qu'un médecin référent
 * principal à la fois. Le partage inter-PS passe par `PatientService`
 * (M:N service↔patient ; tout membre du service voit le patient).
 *
 * - `getReferentsView(patientId)` agrège le référent principal + tous les
 *   membres des services auxquels le patient est rattaché → vue "qui peut
 *   accéder à ce dossier".
 * - `transferReferent(patientId, newProMemberId)` change `PatientReferent.proId`.
 *   Le nouveau référent doit être membre d'un des services du patient.
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"

export type ReferentRole = "primary" | "service-member"

export type ReferentEntry = {
  memberId: number
  userId: number | null
  serviceId: number
  serviceName: string
  role: ReferentRole
}

export const patientReferentService = {
  async getReferentsView(
    patientId: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<ReferentEntry[]> {
    // All members of every service the patient is linked to.
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
    const primary = await prisma.patientReferent.findUnique({
      where: { patientId },
      select: { proId: true },
    })

    const entries: ReferentEntry[] = []
    const seen = new Set<string>()
    for (const link of links) {
      for (const m of link.service.members) {
        const key = `${m.id}:${link.service.id}`
        if (seen.has(key)) continue
        seen.add(key)
        entries.push({
          memberId: m.id,
          userId: m.userId,
          serviceId: link.service.id,
          serviceName: link.service.name,
          role: primary?.proId === m.id ? "primary" : "service-member",
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

  async transferReferent(
    patientId: number,
    newProMemberId: number,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    // Verify the new pro is a member of one of the patient's services.
    const member = await prisma.healthcareMember.findFirst({
      where: {
        id: newProMemberId,
        service: { patientServices: { some: { patientId } } },
      },
      select: { id: true, serviceId: true },
    })
    if (!member) throw new Error("memberNotEligible")

    return prisma.$transaction(async (tx) => {
      const existing = await tx.patientReferent.findUnique({
        where: { patientId },
        select: { proId: true, serviceId: true },
      })

      const updated = await tx.patientReferent.upsert({
        where: { patientId },
        create: { patientId, proId: newProMemberId, serviceId: member.serviceId },
        update: { proId: newProMemberId, serviceId: member.serviceId },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "REFERENT",
        resourceId: String(updated.id),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          patientId,
          previousProId: existing?.proId ?? null,
          newProId: newProMemberId,
        },
      })
      return updated
    })
  },
}
