import { getFcm } from "@/lib/firebase/admin"
import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { logger } from "@/lib/logger"
import type { PushPlatform } from "@prisma/client"
import type { AuditContext } from "./patient.service"

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

interface SendInput {
  userId: number
  templateId?: string
  title: string
  body: string
  data?: Record<string, string>
}

interface SendResult {
  sent: number
  failed: number
  results: { registrationId: string; platform: PushPlatform; status: "sent" | "failed"; messageId?: string; error?: string }[]
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

async function sendWithRetry(token: string, payload: { title: string; body: string; data?: Record<string, string> }, platform: PushPlatform): Promise<{ messageId?: string; error?: string }> {
  const fcm = getFcm()

  const message: Parameters<typeof fcm.send>[0] = {
    token,
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
    ...(platform === "ios" && {
      apns: {
        payload: { aps: { sound: "default", badge: 1 } },
      },
    }),
    ...(platform === "android" && {
      android: {
        priority: "high" as const,
        notification: { sound: "default", channelId: "diabeo_default" },
      },
    }),
    ...(platform === "web" && {
      webpush: {
        notification: { icon: "/logo.svg" },
      },
    }),
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const messageId = await fcm.send(message)
      return { messageId }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        return { error: code }
      }
      if (attempt === MAX_RETRIES) {
        const msg = err instanceof Error ? err.message : "Unknown FCM error"
        return { error: msg }
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt))
    }
  }
  return { error: "maxRetriesExceeded" }
}

export const fcmService = {
  async sendToUser(input: SendInput, ctx?: AuditContext): Promise<SendResult> {
    const registrations = await prisma.pushDeviceRegistration.findMany({
      where: { userId: input.userId, isActive: true },
    })

    if (registrations.length === 0) {
      return { sent: 0, failed: 0, results: [] }
    }

    const results: SendResult["results"] = []

    for (const reg of registrations) {
      const { messageId, error } = await sendWithRetry(
        reg.pushToken,
        { title: input.title, body: input.body, data: input.data },
        reg.platform,
      )

      const status = messageId ? "sent" as const : "failed" as const

      if (error?.includes("not-registered") || error?.includes("invalid-registration-token")) {
        await prisma.pushDeviceRegistration.update({
          where: { id: reg.id },
          data: { isActive: false, unregisteredAt: new Date() },
        })
      }

      await prisma.pushNotificationLog.create({
        data: {
          userId: input.userId,
          registrationId: reg.id,
          templateId: input.templateId,
          platform: reg.platform,
          title: input.title,
          body: input.body,
          dataPayload: input.data ?? undefined,
          status,
          providerMessageId: messageId,
          errorCode: status === "failed" ? (error ?? "unknown") : undefined,
          errorMessage: status === "failed" ? error : undefined,
          sentAt: status === "sent" ? new Date() : undefined,
        },
      })

      results.push({
        registrationId: reg.id,
        platform: reg.platform,
        status,
        messageId: messageId ?? undefined,
        error: error ?? undefined,
      })
    }

    const sent = results.filter((r) => r.status === "sent").length
    const failed = results.filter((r) => r.status === "failed").length

    await auditService.log({
      userId: input.userId,
      action: "CREATE",
      resource: "USER",
      resourceId: `push-send:${input.userId}`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { sent, failed, templateId: input.templateId },
    })

    if (failed > 0) {
      logger.warn("fcm", `${failed}/${registrations.length} push failed for user ${input.userId}`)
    }

    return { sent, failed, results }
  },

  async sendFromTemplate(
    userId: number,
    templateId: string,
    variables?: Record<string, string>,
    ctx?: AuditContext,
  ): Promise<SendResult> {
    const template = await prisma.pushNotificationTemplate.findUnique({
      where: { id: templateId },
    })
    if (!template) throw new Error("templateNotFound")
    if (!template.isActive) throw new Error("templateInactive")

    const vars = variables ?? {}
    const title = renderTemplate(template.titleFr, vars)
    const body = renderTemplate(template.bodyFr, vars)
    const data = template.dataPayload
      ? { ...(template.dataPayload as Record<string, string>), templateId }
      : { templateId }

    return this.sendToUser({ userId, templateId, title, body, data }, ctx)
  },

  async sendToMultipleUsers(
    userIds: number[],
    input: { title: string; body: string; templateId?: string; data?: Record<string, string> },
    ctx?: AuditContext,
  ): Promise<{ total: number; sent: number; failed: number }> {
    let totalSent = 0
    let totalFailed = 0

    for (const userId of userIds) {
      const result = await this.sendToUser(
        { userId, ...input },
        ctx,
      )
      totalSent += result.sent
      totalFailed += result.failed
    }

    return { total: userIds.length, sent: totalSent, failed: totalFailed }
  },
}
