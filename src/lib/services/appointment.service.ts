import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import type { AuditContext } from "./patient.service"
import type { Prisma } from "@prisma/client"

export type AppointmentType = "ide" | "diabeto" | "hdj"

export const appointmentService = {
  async list(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const appointments = await prisma.appointment.findMany({ where: { patientId }, orderBy: { date: "desc" } })

    await auditService.log({
      // US-2268 — list appointments par patient.
      userId: auditUserId, action: "READ", resource: "APPOINTMENT",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      metadata: { patientId },
    })

    return appointments.map((a) => ({ ...a, comment: safeDecryptField(a.comment) }))
  },

  async create(
    patientId: number,
    input: { type: AppointmentType; date: string; hour?: string; comment?: string },
    auditUserId: number, ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          patientId, type: input.type, date: new Date(input.date),
          hour: input.hour ? new Date(`1970-01-01T${input.hour}:00Z`) : null,
          comment: input.comment ? encryptField(input.comment) : null,
        },
      })

      await auditService.logWithTx(tx, {
        // US-2268 — resourceId = appointment.id, patientId pivot.
        userId: auditUserId, action: "CREATE", resource: "APPOINTMENT",
        resourceId: String(appointment.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { patientId },
      })

      return { ...appointment, comment: safeDecryptField(appointment.comment) }
    })
  },

  async update(
    appointmentId: number, patientId: number,
    input: { type?: AppointmentType; date?: string; hour?: string; comment?: string },
    auditUserId: number, ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findFirst({ where: { id: appointmentId, patientId } })
      if (!existing) throw new Error("appointmentNotFound")

      const data: Prisma.AppointmentUpdateInput = {}
      if (input.type !== undefined) data.type = input.type
      if (input.date !== undefined) data.date = new Date(input.date)
      if (input.hour !== undefined) data.hour = new Date(`1970-01-01T${input.hour}:00Z`)
      if (input.comment !== undefined) data.comment = input.comment ? encryptField(input.comment) : null

      const updated = await tx.appointment.update({ where: { id: appointmentId }, data })

      await auditService.logWithTx(tx, {
        // US-2268 — patientId pivot via metadata.
        userId: auditUserId, action: "UPDATE", resource: "APPOINTMENT",
        resourceId: String(appointmentId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { patientId },
      })

      return { ...updated, comment: safeDecryptField(updated.comment) }
    })
  },

  async delete(appointmentId: number, patientId: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findFirst({ where: { id: appointmentId, patientId } })
      if (!existing) throw new Error("appointmentNotFound")

      await tx.appointment.delete({ where: { id: appointmentId } })

      await auditService.logWithTx(tx, {
        // US-2268 — patientId pivot via metadata.
        userId: auditUserId, action: "DELETE", resource: "APPOINTMENT",
        resourceId: String(appointmentId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { patientId },
      })

      return { deleted: true }
    })
  },
}
