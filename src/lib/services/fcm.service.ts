import { getFcm } from "@/lib/firebase/admin"
import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { logger } from "@/lib/logger"
import type { PushPlatform } from "@prisma/client"
import type { AuditContext } from "./patient.service"

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000
const BATCH_CONCURRENCY = 10
const MAX_BATCH_RECIPIENTS = 500
const MAX_VARIABLE_LENGTH = 200

const RETRIABLE_CODES = new Set([
  "messaging/internal-error",
  "messaging/server-unavailable",
  "messaging/unavailable",
])

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
])

interface SendInput {
  userId: number
  senderId: number
  templateId?: string
  title: string
  body: string
  data?: Record<string, string>
}

interface SendResult {
  sent: number
  failed: number
  results: { registrationId: string; platform: PushPlatform; status: "sent" | "failed"; error?: string }[]
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

function pickLocaleField(obj: Record<string, unknown>, field: string, locale: string): string {
  const suffix = locale === "ar" ? "Ar" : locale === "en" ? "En" : "Fr"
  const value = obj[`${field}${suffix}`]
  if (typeof value === "string") return value
  const fallback = obj[`${field}Fr`]
  return typeof fallback === "string" ? fallback : ""
}

function toStringRecord(json: unknown): Record<string, string> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {}
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(json)) {
    if (typeof v === "string") result[k] = v
  }
  return result
}

function sanitizeVariables(vars: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    sanitized[k] = v.slice(0, MAX_VARIABLE_LENGTH)
  }
  return sanitized
}

async function sendWithRetry(
  token: string,
  payload: { title: string; body: string; data?: Record<string, string> },
  platform: PushPlatform,
  idempotencyKey: string,
): Promise<{ messageId?: string; error?: string }> {
  const fcm = getFcm()

  const dataPayload = {
    ...payload.data,
    _title: payload.title,
    _body: payload.body,
    _idempotencyKey: idempotencyKey,
  }

  const message: Parameters<typeof fcm.send>[0] = {
    token,
    data: dataPayload,
    ...(platform === "ios" && {
      apns: {
        payload: {
          aps: {
            "mutable-content": 1,
            alert: { title: payload.title, body: payload.body },
            sound: "default",
            badge: 1,
          },
        },
      },
    }),
    ...(platform === "android" && {
      android: {
        priority: "high" as const,
        notification: { sound: "default", channelId: "diabeo_default", title: payload.title, body: payload.body },
      },
    }),
    ...(platform === "web" && {
      webpush: {
        notification: { title: payload.title, body: payload.body, icon: "/logo.svg" },
      },
    }),
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const messageId = await fcm.send(message)
      return { messageId }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code

      if (INVALID_TOKEN_CODES.has(code ?? "")) {
        return { error: code! }
      }

      if (!RETRIABLE_CODES.has(code ?? "") || attempt === MAX_RETRIES) {
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

    const idempotencyKey = crypto.randomUUID()

    const sendPromises = registrations.map(async (reg) => {
      const { messageId, error } = await sendWithRetry(
        reg.pushToken,
        { title: input.title, body: input.body, data: input.data },
        reg.platform,
        idempotencyKey,
      )

      const status = messageId ? "sent" as const : "failed" as const

      if (error && INVALID_TOKEN_CODES.has(error)) {
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
          title: `[push:${input.templateId ?? "direct"}]`,
          body: "",
          dataPayload: { idempotencyKey, templateId: input.templateId },
          status,
          providerMessageId: messageId,
          errorCode: status === "failed" ? (error ?? "unknown") : undefined,
          errorMessage: status === "failed" ? error : undefined,
          sentAt: status === "sent" ? new Date() : undefined,
        },
      })

      return {
        registrationId: reg.id,
        platform: reg.platform,
        status,
        error: error ?? undefined,
      }
    })

    const results = await Promise.allSettled(sendPromises)
    const flatResults: SendResult["results"] = results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { registrationId: "unknown", platform: "web" as PushPlatform, status: "failed" as const, error: String(r.reason) },
    )

    const sent = flatResults.filter((r) => r.status === "sent").length
    const failed = flatResults.filter((r) => r.status === "failed").length

    await auditService.log({
      userId: input.senderId,
      action: "CREATE",
      resource: "PUSH_NOTIFICATION",
      resourceId: `push-send:${input.userId}`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { recipientUserId: input.userId, sent, failed, templateId: input.templateId },
    })

    if (failed > 0) {
      logger.warn("fcm", `${failed}/${registrations.length} push failed for user ${input.userId}`)
    }

    return { sent, failed, results: flatResults }
  },

  async sendFromTemplate(
    userId: number,
    senderId: number,
    templateId: string,
    variables?: Record<string, string>,
    ctx?: AuditContext,
  ): Promise<SendResult> {
    const template = await prisma.pushNotificationTemplate.findUnique({
      where: { id: templateId },
    })
    if (!template) throw new Error("templateNotFound")
    if (!template.isActive) throw new Error("templateInactive")

    const firstReg = await prisma.pushDeviceRegistration.findFirst({
      where: { userId, isActive: true },
      select: { locale: true },
      orderBy: { lastUsedAt: "desc" },
    })
    const locale = firstReg?.locale ?? "fr"

    const vars = sanitizeVariables(variables ?? {})
    const templateObj = template as unknown as Record<string, unknown>
    const title = renderTemplate(pickLocaleField(templateObj, "title", locale), vars)
    const body = renderTemplate(pickLocaleField(templateObj, "body", locale), vars)
    const data = { ...toStringRecord(template.dataPayload), templateId }

    return this.sendToUser({ userId, senderId, templateId, title, body, data }, ctx)
  },

  async sendToMultipleUsers(
    userIds: number[],
    senderId: number,
    input: { title: string; body: string; templateId?: string; data?: Record<string, string> },
    ctx?: AuditContext,
  ): Promise<{ total: number; sent: number; failed: number }> {
    if (userIds.length > MAX_BATCH_RECIPIENTS) {
      throw new Error(`batchTooLarge:max=${MAX_BATCH_RECIPIENTS}`)
    }

    let totalSent = 0
    let totalFailed = 0

    for (let i = 0; i < userIds.length; i += BATCH_CONCURRENCY) {
      const batch = userIds.slice(i, i + BATCH_CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map((userId) => this.sendToUser({ userId, senderId, ...input }, ctx)),
      )
      for (const r of results) {
        if (r.status === "fulfilled") {
          totalSent += r.value.sent
          totalFailed += r.value.failed
        } else {
          totalFailed++
          logger.error("fcm", "Batch send error", {}, r.reason)
        }
      }
    }

    return { total: userIds.length, sent: totalSent, failed: totalFailed }
  },
}
