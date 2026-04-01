import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

export const healthcareService = {
  /** List all healthcare services (caller must enforce NURSE+ role) */
  async listServices(auditUserId: number, ctx?: AuditContext) {
    const services = await prisma.healthcareService.findMany({
      include: { _count: { select: { members: true, patientServices: true } } },
      orderBy: { name: "asc" },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "SESSION",
      resourceId: "healthcare-services",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return services
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
      include: { service: { include: { members: true } } },
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
  async enrollPatient(patientId: number, serviceId: number, auditUserId: number, ctx?: AuditContext, wait = true) {
    return prisma.$transaction(async (tx) => {
      const service = await tx.healthcareService.findUnique({ where: { id: serviceId } })
      if (!service) throw new Error("serviceNotFound")

      const link = await tx.patientService.create({ data: { patientId, serviceId, wait } })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "PATIENT",
        resourceId: `${patientId}:service:${serviceId}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return link
    })
  },

  /** Remove patient from a service */
  async unenrollPatient(linkId: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const link = await tx.patientService.findUnique({ where: { id: linkId } })
      if (!link) throw new Error("linkNotFound")

      await tx.patientService.delete({ where: { id: linkId } })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "PATIENT",
        resourceId: `service-link:${linkId}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return { deleted: true }
    })
  },

  /** Set patient referent (caller must verify pro belongs to service) */
  async setReferent(patientId: number, proId: number, serviceId: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const member = await tx.healthcareMember.findFirst({ where: { id: proId, serviceId } })
      if (!member) throw new Error("proNotFound")

      const referent = await tx.patientReferent.upsert({
        where: { patientId },
        update: { proId, serviceId },
        create: { patientId, proId, serviceId },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "PATIENT",
        resourceId: `${patientId}:referent`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return referent
    })
  },
}
