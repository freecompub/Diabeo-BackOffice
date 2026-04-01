/**
 * @module events.service
 * @description Diabetes event CRUD — patient-reported events (meals, activities, context, readings).
 * Events can have multiple eventTypes (e.g., insulinMeal + physicalActivity).
 * Comment field is encrypted. All creates/updates/deletes logged for audit.
 * @see CLAUDE.md#events — Event model and cross-validation
 * @see src/lib/validators/events — DiabetesEventInput schema with superRefine validation
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import type { DiabetesEventInput } from "@/lib/validators/events"
import type { AuditContext } from "./patient.service"

/**
 * Diabetes event service — CRUD operations with encryption and audit.
 * @namespace eventsService
 */
export const eventsService = {
  /**
   * Create a diabetes event (meal, activity, glycemia reading, context).
   * Encrypts comment field. Can have multiple eventTypes.
   * @async
   * @param {number} patientId - Patient ID
   * @param {DiabetesEventInput} input - Event data (from Zod-validated schema)
   * @param {number} auditUserId - User performing creation (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Object>} Created event with decrypted comment
   */
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

  /**
   * Update an existing diabetes event.
   * Encrypts comment field if provided. Validates ownership (patientId match).
   * @async
   * @param {string} eventId - Event ID to update
   * @param {number} patientId - Patient ID (for ownership check)
   * @param {Object} input - Partial update (any fields)
   * @param {number} auditUserId - User performing update (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Object>} Updated event with decrypted comment
   * @throws {Error} If event not found or patient mismatch
   */
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

  /**
   * Delete a diabetes event.
   * Validates ownership (patientId match). Logs DELETE audit entry.
   * @async
   * @param {string} eventId - Event ID to delete
   * @param {number} patientId - Patient ID (for ownership check)
   * @param {number} auditUserId - User performing deletion (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<{deleted: boolean}>} Deletion confirmation
   * @throws {Error} If event not found or patient mismatch
   */
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
