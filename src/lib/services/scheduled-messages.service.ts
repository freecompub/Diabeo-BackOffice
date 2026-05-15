/**
 * @module scheduled-messages.service
 * @description Groupe 10 Batch D — US-2261 messages programmés au patient.
 *
 * Wrapper CRUD léger sur `PushScheduledNotification` existant (domaine
 * Push). Le DOCTOR programme un message pour un patient à une date
 * future ; l'exécution est gérée par le cron worker push (out of scope).
 *
 * ⚠️ V2 deferrals :
 *  - Idempotence dedup (OrchestrationLog table)
 *  - Retry exponential backoff sur échec push
 *  - Préférences patient opt-out par type
 */

import {
  ScheduleType,
  PushPlatform,
  type Prisma,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"

export type ScheduledMessageItem = {
  id: string
  targetUserId: number
  templateId: string
  scheduleType: ScheduleType
  scheduledAt: Date | null
  templateVariables: Record<string, unknown> | null
  isActive: boolean
  occurrencesCount: number
  maxOccurrences: number | null
  expiresAt: Date | null
  createdAt: Date
}

const SCHEDULED_MESSAGES_LIMIT = 50

export const scheduledMessagesService = {
  /**
   * Liste les messages programmés ciblant le patient (via `Patient.userId`
   * → `PushScheduledNotification.userId`). Filtré sur `isActive` par
   * défaut, peut être étendu pour inclure les messages historiques.
   */
  async listForPatient(
    patientId: number, auditUserId: number,
    options: { includeInactive?: boolean } = {},
    ctx?: AuditContext,
  ): Promise<ScheduledMessageItem[]> {
    // Resolve patient.userId — gate already enforced at route layer.
    const patient = await prisma.patient.findUnique({
      where: { id: patientId, deletedAt: null },
      select: { userId: true },
    })
    if (!patient) return []

    const rows = await prisma.pushScheduledNotification.findMany({
      where: {
        userId: patient.userId,
        ...(options.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
      take: SCHEDULED_MESSAGES_LIMIT,
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PUSH_SCHEDULED_NOTIFICATION",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "scheduled_messages.list", count: rows.length },
    })

    return rows.map((r) => ({
      id: r.id,
      targetUserId: r.userId,
      templateId: r.templateId,
      scheduleType: r.scheduleType,
      scheduledAt: r.scheduledAt,
      templateVariables: r.templateVariables as Record<string, unknown> | null,
      isActive: r.isActive,
      occurrencesCount: r.occurrencesCount,
      maxOccurrences: r.maxOccurrences,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }))
  },

  /**
   * Programme un message one-shot pour un patient à une date future.
   */
  async schedule(
    patientId: number,
    input: {
      templateId: string
      scheduledAt: Date
      templateVariables?: Record<string, unknown>
      expiresAt?: Date
    },
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ScheduledMessageItem> {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId, deletedAt: null },
      select: { userId: true },
    })
    if (!patient) throw new Error("patientNotFound")

    const created = await prisma.pushScheduledNotification.create({
      data: {
        userId: patient.userId,
        templateId: input.templateId,
        scheduleType: ScheduleType.once,
        scheduledAt: input.scheduledAt,
        templateVariables: input.templateVariables
          ? (input.templateVariables as Prisma.InputJsonValue)
          : undefined,
        platforms: [PushPlatform.ios, PushPlatform.android, PushPlatform.web],
        isActive: true,
        nextTriggerAt: input.scheduledAt,
        expiresAt: input.expiresAt ?? undefined,
      },
    })

    await auditService.log({
      userId: auditUserId, action: "CREATE", resource: "PUSH_SCHEDULED_NOTIFICATION",
      resourceId: created.id,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: {
        patientId,
        kind: "scheduled_messages.schedule",
        templateId: input.templateId,
        scheduledAt: input.scheduledAt.toISOString(),
      },
    })

    return {
      id: created.id,
      targetUserId: created.userId,
      templateId: created.templateId,
      scheduleType: created.scheduleType,
      scheduledAt: created.scheduledAt,
      templateVariables: created.templateVariables as Record<string, unknown> | null,
      isActive: created.isActive,
      occurrencesCount: created.occurrencesCount,
      maxOccurrences: created.maxOccurrences,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
    }
  },

  /**
   * Annule un message programmé en mettant `isActive=false`. Ne supprime
   * pas la ligne (audit historique conservé).
   */
  async cancel(
    notifId: string, patientId: number,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<{ cancelled: boolean }> {
    // Verify the row belongs to this patient before cancelling
    // (defense-in-depth against cross-tenant cancellation via guessed ID).
    const patient = await prisma.patient.findUnique({
      where: { id: patientId, deletedAt: null },
      select: { userId: true },
    })
    if (!patient) return { cancelled: false }
    const row = await prisma.pushScheduledNotification.findFirst({
      where: { id: notifId, userId: patient.userId, isActive: true },
      select: { id: true },
    })
    if (!row) {
      // M2 (re-review) — emit a distinct audit row on not-found so brute-
      //   force notifId enumeration leaves a trail (US-2265 burst-detection
      //   territory). No PHI leaked : only the patientId + the guessed
      //   notifId are recorded.
      await auditService.log({
        userId: auditUserId, action: "UPDATE", resource: "PUSH_SCHEDULED_NOTIFICATION",
        resourceId: notifId,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, kind: "scheduled_messages.cancel.notFound" },
      })
      return { cancelled: false }
    }

    await prisma.pushScheduledNotification.update({
      where: { id: notifId },
      data: { isActive: false },
    })

    await auditService.log({
      userId: auditUserId, action: "UPDATE", resource: "PUSH_SCHEDULED_NOTIFICATION",
      resourceId: notifId,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "scheduled_messages.cancel" },
    })

    return { cancelled: true }
  },
}
