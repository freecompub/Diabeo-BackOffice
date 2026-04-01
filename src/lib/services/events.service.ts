import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import type { DiabetesEventInput } from "@/lib/validators/events"
import type { AuditContext } from "./patient.service"

export const eventsService = {
  async create(
    patientId: number,
    input: DiabetesEventInput,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const event = await tx.diabetesEvent.create({
        data: {
          patientId,
          eventDate: new Date(input.eventDate),
          eventTypes: input.eventTypes,
          glycemiaValue: input.glycemiaValue,
          carbohydrates: input.carbohydrates,
          bolusDose: input.bolusDose,
          basalDose: input.basalDose,
          activityType: input.activityType,
          activityDuration: input.activityDuration,
          contextType: input.contextType,
          weight: input.weight,
          hba1c: input.hba1c,
          ketones: input.ketones,
          systolicPressure: input.systolicPressure,
          diastolicPressure: input.diastolicPressure,
          comment: input.comment ? encryptField(input.comment) : null,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "DIABETES_EVENT",
        resourceId: event.id,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return { ...event, comment: safeDecryptField(event.comment) }
    })
  },

  async update(
    eventId: string,
    patientId: number,
    input: Record<string, unknown>,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.diabetesEvent.findFirst({
        where: { id: eventId, patientId },
      })
      if (!existing) throw new Error("eventNotFound")

      const data: Record<string, unknown> = {}
      if (input.eventDate) data.eventDate = new Date(input.eventDate as string)
      if (input.glycemiaValue !== undefined) data.glycemiaValue = input.glycemiaValue
      if (input.carbohydrates !== undefined) data.carbohydrates = input.carbohydrates
      if (input.bolusDose !== undefined) data.bolusDose = input.bolusDose
      if (input.basalDose !== undefined) data.basalDose = input.basalDose
      if (input.activityType !== undefined) data.activityType = input.activityType
      if (input.activityDuration !== undefined) data.activityDuration = input.activityDuration
      if (input.contextType !== undefined) data.contextType = input.contextType
      if (input.weight !== undefined) data.weight = input.weight
      if (input.hba1c !== undefined) data.hba1c = input.hba1c
      if (input.ketones !== undefined) data.ketones = input.ketones
      if (input.systolicPressure !== undefined) data.systolicPressure = input.systolicPressure
      if (input.diastolicPressure !== undefined) data.diastolicPressure = input.diastolicPressure
      if (input.comment !== undefined) {
        data.comment = input.comment ? encryptField(input.comment as string) : null
      }

      const event = await tx.diabetesEvent.update({
        where: { id: eventId },
        data,
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "DIABETES_EVENT",
        resourceId: eventId,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return { ...event, comment: safeDecryptField(event.comment) }
    })
  },

  async delete(eventId: string, patientId: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.diabetesEvent.findFirst({
        where: { id: eventId, patientId },
      })
      if (!existing) throw new Error("eventNotFound")

      await tx.diabetesEvent.delete({ where: { id: eventId } })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "DIABETES_EVENT",
        resourceId: eventId,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return { deleted: true }
    })
  },
}
