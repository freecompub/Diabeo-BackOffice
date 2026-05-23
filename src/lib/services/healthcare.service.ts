import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

export interface MembershipDTO {
  memberId: number
  memberName: string
  serviceId: number
  serviceName: string
  establishment: string | null
}

export const healthcareService = {
  /**
   * US-2500-UI iter 4 — Memberships du user connecté.
   *
   * Retourne tous les `HealthcareMember` où `userId === auditUserId`,
   * avec leur service rattaché. Utilisé par le filtre membre cabinet
   * du calendrier RDV pour auto-résoudre le memberId par défaut
   * (DOCTOR/NURSE qui appartient à un cabinet) ou afficher un dropdown
   * (rare cas multi-cabinets, ADMIN).
   *
   * Pas d'audit log nécessaire (lecture de ses propres memberships,
   * pas de PHI patient impliqué).
   */
  async getMembershipsForUser(userId: number): Promise<MembershipDTO[]> {
    const memberships = await prisma.healthcareMember.findMany({
      where: { userId },
      include: {
        service: {
          select: { id: true, name: true, establishment: true },
        },
      },
      orderBy: { name: "asc" },
    })

    // FK `serviceId` non-nullable dans schema (cf. HealthcareMember),
    // mais TS infère nullable via include. On filtre defense-in-depth.
    return memberships
      .filter((m): m is typeof m & { service: NonNullable<typeof m.service> } => m.service !== null)
      .map((m) => ({
        memberId: m.id,
        memberName: m.name,
        serviceId: m.service.id,
        serviceName: m.service.name,
        establishment: m.service.establishment,
      }))
  },

  /** List all healthcare services (caller must enforce NURSE+ role) */
  async listServices(auditUserId: number, ctx?: AuditContext) {
    const services = await prisma.healthcareService.findMany({
      include: { _count: { select: { members: true, patientServices: true } } },
      orderBy: { name: "asc" },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      // US-2268 — listing global, pas SESSION.
      resource: "HEALTHCARE_SERVICE",
      resourceId: "list",
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
      // US-2268 — équipe soignante d'un patient.
      resource: "HEALTHCARE_SERVICE",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, kind: "members" },
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
        // US-2268 — resourceId = link.id, patientId + serviceId pivots.
        userId: auditUserId, action: "CREATE", resource: "PATIENT_SERVICE_LINK",
        resourceId: String(link.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { patientId, serviceId },
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
        // US-2268 — resourceId = link.id, patientId pivot via metadata.
        userId: auditUserId, action: "DELETE", resource: "PATIENT_SERVICE_LINK",
        resourceId: String(linkId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { patientId: link.patientId, serviceId: link.serviceId },
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
        // US-2268 — referent = singleton par patient.
        userId: auditUserId, action: "UPDATE", resource: "REFERENT",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { patientId, proId, serviceId },
      })

      return referent
    })
  },
}
