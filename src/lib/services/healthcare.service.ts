import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

export const healthcareService = {
  /** List all healthcare services */
  async listServices() {
    return prisma.healthcareService.findMany({
      include: { _count: { select: { members: true, patientServices: true } } },
      orderBy: { name: "asc" },
    })
  },

  /** Get a service with its members */
  async getService(serviceId: number) {
    return prisma.healthcareService.findUnique({
      where: { id: serviceId },
      include: { members: true },
    })
  },

  /** Get healthcare members for a patient (via their services) */
  async getMembersForPatient(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const links = await prisma.patientService.findMany({
      where: { patientId },
      include: {
        service: { include: { members: true } },
      },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: `${patientId}:members`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return links.flatMap((l) => l.service.members)
  },

  /** Enroll patient in a service */
  async enrollPatient(patientId: number, serviceId: number, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      const link = await tx.patientService.create({
        data: { patientId, serviceId, wait: true },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "PATIENT",
        resourceId: `${patientId}:service:${serviceId}`,
      })

      return link
    })
  },

  /** Remove patient from a service */
  async unenrollPatient(linkId: number, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      const link = await tx.patientService.findUnique({ where: { id: linkId } })
      if (!link) throw new Error("linkNotFound")

      await tx.patientService.delete({ where: { id: linkId } })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "PATIENT",
        resourceId: `service-link:${linkId}`,
      })

      return { deleted: true }
    })
  },

  /** Set patient referent */
  async setReferent(patientId: number, proId: number, serviceId: number, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      const referent = await tx.patientReferent.upsert({
        where: { patientId },
        update: { proId, serviceId },
        create: { patientId, proId, serviceId },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:referent`,
      })

      return referent
    })
  },
}
