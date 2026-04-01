import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"
import type { PushPlatform, ScheduleType } from "@prisma/client"

function maskToken(token: string): string {
  if (token.length <= 10) return "***"
  return `${token.slice(0, 6)}...${token.slice(-4)}`
}

export const pushService = {
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
      await tx.pushDeviceRegistration.updateMany({
        where: { pushToken: input.pushToken, userId: { not: userId } },
        data: { isActive: false, unregisteredAt: new Date() },
      })

      const reg = await tx.pushDeviceRegistration.upsert({
        where: { pushToken: input.pushToken },
        update: {
          platform: input.platform,
          deviceName: input.deviceName,
          deviceModel: input.deviceModel,
          osVersion: input.osVersion,
          appVersion: input.appVersion,
          appBundleId: input.appBundleId,
          locale: input.locale,
          pushTimezone: input.pushTimezone,
          isSandbox: input.isSandbox,
          userId,
          isActive: true,
          lastUsedAt: new Date(),
          unregisteredAt: null,
        },
        create: { ...input, userId },
      })

      await auditService.logWithTx(tx, {
        userId, action: "CREATE", resource: "SESSION",
        resourceId: `push-reg:${reg.id}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return { ...reg, pushToken: maskToken(reg.pushToken) }
    })
  },

  async unregister(registrationId: string, userId: number, ctx?: AuditContext) {
    const reg = await prisma.pushDeviceRegistration.findFirst({
      where: { id: registrationId, userId },
    })
    if (!reg) throw new Error("registrationNotFound")

    await prisma.pushDeviceRegistration.update({
      where: { id: registrationId },
      data: { isActive: false, unregisteredAt: new Date() },
    })

    await auditService.log({
      userId, action: "DELETE", resource: "SESSION",
      resourceId: `push-reg:${registrationId}`,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return { unregistered: true }
  },

  async unregisterAll(userId: number, ctx?: AuditContext) {
    await prisma.pushDeviceRegistration.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, unregisteredAt: new Date() },
    })

    await auditService.log({
      userId, action: "DELETE", resource: "SESSION",
      resourceId: `push-reg:all:${userId}`,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return { unregisteredAll: true }
  },

  async listTemplates() {
    return prisma.pushNotificationTemplate.findMany({
      where: { isActive: true },
      orderBy: { category: "asc" },
    })
  },

  async getTemplate(templateId: string) {
    return prisma.pushNotificationTemplate.findUnique({ where: { id: templateId } })
  },

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
      templateVariables?: Record<string, string>
      maxOccurrences?: number
    },
    ctx?: AuditContext,
  ) {
    const sched = await prisma.pushScheduledNotification.create({
      data: {
        user: { connect: { id: userId } },
        template: { connect: { id: input.templateId } },
        scheduleType: input.scheduleType,
        scheduledAt: input.scheduledAt,
        cronExpression: input.cronExpression,
        cronTimezone: input.cronTimezone ?? "Europe/Paris",
        templateVariables: input.templateVariables ?? undefined,
        maxOccurrences: input.maxOccurrences,
      },
    })

    await auditService.log({
      userId, action: "CREATE", resource: "SESSION",
      resourceId: `push-sched:${sched.id}`,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return sched
  },

  async pauseScheduled(scheduleId: string, userId: number, ctx?: AuditContext) {
    const sched = await prisma.pushScheduledNotification.findFirst({ where: { id: scheduleId, userId } })
    if (!sched) throw new Error("scheduleNotFound")

    const updated = await prisma.pushScheduledNotification.update({ where: { id: scheduleId }, data: { isActive: false } })

    await auditService.log({
      userId, action: "UPDATE", resource: "SESSION",
      resourceId: `push-sched:${scheduleId}:pause`,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return updated
  },

  async resumeScheduled(scheduleId: string, userId: number, ctx?: AuditContext) {
    const sched = await prisma.pushScheduledNotification.findFirst({ where: { id: scheduleId, userId } })
    if (!sched) throw new Error("scheduleNotFound")

    const updated = await prisma.pushScheduledNotification.update({ where: { id: scheduleId }, data: { isActive: true } })

    await auditService.log({
      userId, action: "UPDATE", resource: "SESSION",
      resourceId: `push-sched:${scheduleId}:resume`,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return updated
  },
}
