import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"
import type { PushPlatform, ScheduleType, Prisma } from "@prisma/client"

/** Mask push token for API responses */
function maskToken(token: string): string {
  if (token.length <= 10) return "***"
  return `${token.slice(0, 6)}...${token.slice(-4)}`
}

export const pushService = {
  // --- Registration ---
  async listRegistrations(userId: number) {
    const regs = await prisma.pushDeviceRegistration.findMany({
      where: { userId, isActive: true },
    })
    return regs.map((r) => ({ ...r, pushToken: maskToken(r.pushToken) }))
  },

  async register(
    userId: number,
    input: {
      platform: PushPlatform; pushToken: string; deviceName?: string
      deviceModel?: string; osVersion?: string; appVersion?: string
      appBundleId?: string; locale?: string; pushTimezone?: string
      isSandbox?: boolean
    },
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      // Deactivate if token already registered by another user
      await tx.pushDeviceRegistration.updateMany({
        where: { pushToken: input.pushToken, userId: { not: userId } },
        data: { isActive: false, unregisteredAt: new Date() },
      })

      const reg = await tx.pushDeviceRegistration.upsert({
        where: { pushToken: input.pushToken },
        update: { ...input, userId, isActive: true, lastUsedAt: new Date(), unregisteredAt: null },
        create: { ...input, userId },
      })

      return { ...reg, pushToken: maskToken(reg.pushToken) }
    })
  },

  async unregister(registrationId: string, userId: number) {
    const reg = await prisma.pushDeviceRegistration.findFirst({
      where: { id: registrationId, userId },
    })
    if (!reg) throw new Error("registrationNotFound")

    await prisma.pushDeviceRegistration.update({
      where: { id: registrationId },
      data: { isActive: false, unregisteredAt: new Date() },
    })

    return { unregistered: true }
  },

  async unregisterAll(userId: number) {
    await prisma.pushDeviceRegistration.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, unregisteredAt: new Date() },
    })
    return { unregisteredAll: true }
  },

  // --- Templates ---
  async listTemplates() {
    return prisma.pushNotificationTemplate.findMany({
      where: { isActive: true },
      orderBy: { category: "asc" },
    })
  },

  async getTemplate(templateId: string) {
    return prisma.pushNotificationTemplate.findUnique({ where: { id: templateId } })
  },

  // --- Scheduled ---
  async listScheduled(userId: number) {
    return prisma.pushScheduledNotification.findMany({
      where: { userId },
      orderBy: { nextTriggerAt: "asc" },
    })
  },

  async createScheduled(
    userId: number,
    input: {
      templateId: string; scheduleType: ScheduleType
      scheduledAt?: Date; cronExpression?: string; cronTimezone?: string
      templateVariables?: Record<string, unknown>
      maxOccurrences?: number
    },
  ) {
    return prisma.pushScheduledNotification.create({
      data: {
        user: { connect: { id: userId } },
        template: { connect: { id: input.templateId } },
        scheduleType: input.scheduleType,
        scheduledAt: input.scheduledAt,
        cronExpression: input.cronExpression,
        cronTimezone: input.cronTimezone,
        templateVariables: input.templateVariables ? JSON.parse(JSON.stringify(input.templateVariables)) : undefined,
        maxOccurrences: input.maxOccurrences,
      },
    })
  },

  async pauseScheduled(scheduleId: string, userId: number) {
    const sched = await prisma.pushScheduledNotification.findFirst({
      where: { id: scheduleId, userId },
    })
    if (!sched) throw new Error("scheduleNotFound")

    return prisma.pushScheduledNotification.update({
      where: { id: scheduleId },
      data: { isActive: false },
    })
  },

  async resumeScheduled(scheduleId: string, userId: number) {
    const sched = await prisma.pushScheduledNotification.findFirst({
      where: { id: scheduleId, userId },
    })
    if (!sched) throw new Error("scheduleNotFound")

    return prisma.pushScheduledNotification.update({
      where: { id: scheduleId },
      data: { isActive: true },
    })
  },
}
