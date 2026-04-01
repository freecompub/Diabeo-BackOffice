import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import type { AuditContext } from "./patient.service"

export const appointmentService = {
  /** List appointments for a patient */
  async list(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const appointments = await prisma.appointment.findMany({
      where: { patientId },
      orderBy: { date: "desc" },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: `${patientId}:appointments`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    // Decrypt comments
    return appointments.map((a) => ({
      ...a,
      comment: safeDecryptField(a.comment),
    }))
  },

  /** Create an appointment */
  async create(
    patientId: number,
    input: { type: string; date: string; hour?: string; comment?: string },
    auditUserId: number,
  ) {
    return prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          patientId,
          type: input.type,
          date: new Date(input.date),
          hour: input.hour ? new Date(`1970-01-01T${input.hour}:00Z`) : null,
          comment: input.comment ? encryptField(input.comment) : null,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "PATIENT",
        resourceId: `appointment:${appointment.id}`,
      })

      return { ...appointment, comment: safeDecryptField(appointment.comment) }
    })
  },

  /** Update an appointment */
  async update(
    appointmentId: number,
    patientId: number,
    input: { type?: string; date?: string; hour?: string; comment?: string },
    auditUserId: number,
  ) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findFirst({
        where: { id: appointmentId, patientId },
      })
      if (!existing) throw new Error("appointmentNotFound")

      const data: Record<string, unknown> = {}
      if (input.type !== undefined) data.type = input.type
      if (input.date !== undefined) data.date = new Date(input.date)
      if (input.hour !== undefined) data.hour = new Date(`1970-01-01T${input.hour}:00Z`)
      if (input.comment !== undefined) data.comment = input.comment ? encryptField(input.comment) : null

      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data,
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `appointment:${appointmentId}`,
      })

      return { ...updated, comment: safeDecryptField(updated.comment) }
    })
  },

  /** Delete an appointment */
  async delete(appointmentId: number, patientId: number, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findFirst({
        where: { id: appointmentId, patientId },
      })
      if (!existing) throw new Error("appointmentNotFound")

      await tx.appointment.delete({ where: { id: appointmentId } })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "PATIENT",
        resourceId: `appointment:${appointmentId}`,
      })

      return { deleted: true }
    })
  },
}
