/**
 * @module services/appointment-reminder
 * @description US-2502 — Rappels RDV multi-canal (Batch 2 Groupe 8 RDV).
 *
 * Cron quotidien J-2 email / J-1 SMS / J-0 push.
 *
 * ### Channels
 *
 *   - **email** (J-2) via Resend (US-2074). Anti-PHI strict (date+lieu seulement).
 *   - **sms**   (J-1) via `sms.service` (US-2506 V1 mock, real Twilio V3).
 *     Verifie `cabinet.smsEnabled` + credits avant.
 *   - **push**  (J-0) via `fcm.service` (US-2073). Data-only, sans PHI.
 *
 * ### Idempotence absolue
 *
 * `@@unique([appointmentId, channel, step])` empeche envoi double.
 * Advisory lock global anti double-trigger cron concurrents.
 *
 * ### Securite HDS / RGPD
 *
 *   - `sentToEnc` chiffre AES-256-GCM (email/phone/fcmToken selon channel).
 *   - `metadata.patientId` propagé US-2268 (ADR #18 forensique).
 *   - Filtre RGPD Art. 17 : `patient.deletedAt: null + user.status='active'`.
 *   - Filtre `appointment.status IN ('scheduled', 'confirmed')` — pas de
 *     rappel pour cancelled/completed/no_show.
 *   - Audit USER null (cron sentinel système — pas userId=0 qui violait FK).
 */

import { Prisma } from "@prisma/client"
import type {
  AppointmentReminderChannel,
  AppointmentReminderStep,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService, type AuditContext } from "./audit.service"
import { emailService } from "./email.service"
import { fcmService } from "./fcm.service"
import { smsService, SmsDisabledError, SmsInsufficientCreditError, SmsValidationError } from "./sms.service"
import { logger } from "@/lib/logger"

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

interface ReminderStepConfig {
  step: AppointmentReminderStep
  channel: AppointmentReminderChannel
  daysBeforeDate: number
}

export const APPOINTMENT_REMINDER_STEPS: readonly ReminderStepConfig[] = [
  { step: "j_minus_2", channel: "email", daysBeforeDate: 2 },
  { step: "j_minus_1", channel: "sms", daysBeforeDate: 1 },
  { step: "j_0", channel: "push", daysBeforeDate: 0 },
] as const

export const MAX_APPOINTMENTS_PER_STEP = 500
const CRON_TIMEOUT_MS = 50_000
const PARALLEL_CONCURRENCY = 10

const CRON_AUDIT_USER_ID = null as number | null

// ─────────────────────────────────────────────────────────────
// Audit kinds
// ─────────────────────────────────────────────────────────────

export type AppointmentReminderAuditKind =
  | "appointment.reminder.sent"
  | "appointment.reminder.failed"
  | "appointment.reminder.skipped"
  | "appointment.reminder.cron.run"
  | "appointment.reminder.cron.skipped_locked"
  | "appointment.reminder.cron.timeout"

const AUDIT_KIND = {
  SENT: "appointment.reminder.sent",
  FAILED: "appointment.reminder.failed",
  SKIPPED: "appointment.reminder.skipped",
  CRON_RUN: "appointment.reminder.cron.run",
  CRON_SKIPPED_LOCKED: "appointment.reminder.cron.skipped_locked",
  CRON_TIMEOUT: "appointment.reminder.cron.timeout",
} as const satisfies Record<string, AppointmentReminderAuditKind>

export { AUDIT_KIND as APPT_REMINDER_AUDIT_KIND }

// ─────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────

type ResultKind = "sent" | "failed" | "skipped"

export interface ApptReminderRunMetrics {
  processed: number
  sent: number
  failed: number
  skipped: number
  byChannel: Record<AppointmentReminderChannel, { sent: number; failed: number; skipped: number }>
  timedOut: boolean
  skippedConcurrent: boolean
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function emptyMetrics(): ApptReminderRunMetrics {
  return {
    processed: 0, sent: 0, failed: 0, skipped: 0,
    timedOut: false, skippedConcurrent: false,
    byChannel: {
      email: { sent: 0, failed: 0, skipped: 0 },
      sms: { sent: 0, failed: 0, skipped: 0 },
      push: { sent: 0, failed: 0, skipped: 0 },
    },
  }
}

const ALLOWED_LANGUAGES = ["fr", "en", "ar"] as const
type AllowedLanguage = typeof ALLOWED_LANGUAGES[number]
function normalizeLanguage(raw: string | null | undefined): AllowedLanguage {
  if (raw && (ALLOWED_LANGUAGES as readonly string[]).includes(raw)) {
    return raw as AllowedLanguage
  }
  return "fr"
}

function formatDateTime(date: Date, hour: Date | null, language: AllowedLanguage): string {
  const locale = language === "ar" ? "ar-DZ" : language === "en" ? "en-US" : "fr-FR"
  // Combine date + hour into a single Date at appropriate local time.
  let combined: Date
  if (hour) {
    combined = new Date(date)
    combined.setUTCHours(hour.getUTCHours(), hour.getUTCMinutes(), 0, 0)
  } else {
    combined = date
  }
  try {
    const datePart = new Intl.DateTimeFormat(locale, {
      day: "numeric", month: "long", year: "numeric",
    }).format(combined)
    if (!hour) return datePart
    const timePart = new Intl.DateTimeFormat(locale, {
      hour: "2-digit", minute: "2-digit",
    }).format(combined)
    return `${datePart} ${language === "fr" ? "à" : language === "en" ? "at" : "في"} ${timePart}`
  } catch {
    return combined.toISOString().split("T")[0] ?? combined.toISOString()
  }
}

function sanitizeProviderError(msg: string, sensitive: string | null): string {
  let s = msg
  if (sensitive && sensitive.length > 0) {
    const escaped = sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    s = s.replace(new RegExp(escaped, "gi"), "<recipient>")
  }
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "<recipient>")
  s = s.replace(/\+\d{8,15}/g, "<phone>")
  return s.slice(0, 500)
}

function pLimit<T>(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []
  const next = () => {
    if (active < concurrency && queue.length > 0) {
      active += 1
      const fn = queue.shift()!
      fn()
    }
  }
  return (fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(resolve, reject).finally(() => {
          active -= 1
          next()
        })
      }
      queue.push(run)
      next()
    })
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export const appointmentReminderService = {
  /**
   * Cron entrypoint quotidien.
   *
   * Advisory lock global + parallel p-limit + timeout 50s + filtre
   * RGPD Art. 17 + idempotence UNIQUE.
   */
  async processAppointmentReminders(
    now: Date,
    ctx: AuditContext,
  ): Promise<ApptReminderRunMetrics> {
    const metrics = emptyMetrics()
    const t0 = Date.now()

    return prisma.$transaction(async (tx) => {
      const lockResult = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(
          hashtextextended('appointment-reminder-cron', 0)
        ) AS locked
      `
      const locked = lockResult[0]?.locked === true
      if (!locked) {
        metrics.skippedConcurrent = true
        await auditService.logWithTx(tx, {
          userId: CRON_AUDIT_USER_ID,
          action: "CREATE",
          resource: "APPOINTMENT_REMINDER",
          resourceId: "cron",
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: { kind: AUDIT_KIND.CRON_SKIPPED_LOCKED },
        }).catch((err) => {
          logger.error(
            "appointment-reminder",
            "audit cron.skipped_locked failed",
            { kind: "audit.write.failed" },
            err,
          )
        })
        return metrics
      }

      const limit = pLimit<ResultKind>(PARALLEL_CONCURRENCY)

      for (const stepCfg of APPOINTMENT_REMINDER_STEPS) {
        if (Date.now() - t0 > CRON_TIMEOUT_MS) {
          metrics.timedOut = true
          break
        }
        // Target date = now + daysBeforeDate (date only, no time).
        const targetDate = new Date(now)
        targetDate.setUTCDate(targetDate.getUTCDate() + stepCfg.daysBeforeDate)
        targetDate.setUTCHours(0, 0, 0, 0)
        const nextDate = new Date(targetDate)
        nextDate.setUTCDate(nextDate.getUTCDate() + 1)

        const appointments = await tx.appointment.findMany({
          where: {
            status: { in: ["scheduled", "confirmed"] },
            date: { gte: targetDate, lt: nextDate },
            reminders: {
              none: { channel: stepCfg.channel, step: stepCfg.step },
            },
            patient: {
              deletedAt: null,
              user: { status: "active" },
            },
          },
          select: {
            id: true,
            patientId: true,
            date: true,
            hour: true,
            location: true,
            member: {
              select: {
                serviceId: true,
              },
            },
            patient: {
              select: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    phone: true,
                    language: true,
                  },
                },
              },
            },
          },
          orderBy: { date: "asc" },
          take: MAX_APPOINTMENTS_PER_STEP,
        })

        const tasks: Array<Promise<ResultKind>> = []
        for (const appt of appointments) {
          if (Date.now() - t0 > CRON_TIMEOUT_MS) {
            metrics.timedOut = true
            break
          }
          tasks.push(
            limit(() => this.sendReminderForAppointment(appt, stepCfg, ctx)),
          )
        }
        const results = await Promise.allSettled(tasks)
        for (const r of results) {
          if (r.status === "fulfilled") {
            metrics.processed += 1
            metrics[r.value] += 1
            metrics.byChannel[stepCfg.channel][r.value] += 1
          } else {
            metrics.processed += 1
            metrics.failed += 1
            metrics.byChannel[stepCfg.channel].failed += 1
            logger.error(
              "appointment-reminder",
              "task unexpected throw",
              { resource: "APPOINTMENT_REMINDER" },
              r.reason,
            )
          }
        }
        if (metrics.timedOut) break
      }

      const auditKind = metrics.timedOut ? AUDIT_KIND.CRON_TIMEOUT : AUDIT_KIND.CRON_RUN
      await auditService.logWithTx(tx, {
        userId: CRON_AUDIT_USER_ID,
        action: "CREATE",
        resource: "APPOINTMENT_REMINDER",
        resourceId: "cron",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          kind: auditKind,
          processed: metrics.processed,
          sent: metrics.sent,
          failed: metrics.failed,
          skipped: metrics.skipped,
          durationMs: Date.now() - t0,
        },
      }).catch((err) => {
        logger.error(
          "appointment-reminder",
          "audit cron.run failed",
          { kind: "audit.write.failed" },
          err,
        )
      })

      return metrics
    })
  },

  /**
   * Envoi single reminder (1 channel × 1 step) + persist + audit.
   *
   * @internal
   */
  async sendReminderForAppointment(
    appt: {
      id: number
      patientId: number
      date: Date
      hour: Date | null
      location: "in_person" | "video" | "phone" | null
      member: { serviceId: number | null } | null
      patient: {
        user: {
          id: number
          email: string
          phone: string | null
          language: string | null
        }
      }
    },
    stepCfg: ReminderStepConfig,
    ctx: AuditContext,
  ): Promise<ResultKind> {
    const language = normalizeLanguage(appt.patient.user.language)
    const dateTimeFormatted = formatDateTime(appt.date, appt.hour, language)

    if (stepCfg.channel === "email") {
      return this.sendEmailReminder(appt, stepCfg, dateTimeFormatted, language, ctx)
    }
    if (stepCfg.channel === "sms") {
      return this.sendSmsReminder(appt, stepCfg, dateTimeFormatted, language, ctx)
    }
    return this.sendPushReminder(appt, stepCfg, dateTimeFormatted, language, ctx)
  },

  // ─── Channel : email J-2 ───────────────────────────────────────
  async sendEmailReminder(
    appt: {
      id: number; patientId: number; date: Date; hour: Date | null;
      location: "in_person" | "video" | "phone" | null
      patient: { user: { email: string } }
    },
    stepCfg: ReminderStepConfig,
    dateTimeFormatted: string,
    language: AllowedLanguage,
    ctx: AuditContext,
  ): Promise<ResultKind> {
    const emailPlain = safeDecryptField(appt.patient.user.email)
    if (!emailPlain) {
      await this.persistReminder(
        appt.id, stepCfg, "skipped", null, null, "email_decrypt_failed",
        appt.patientId, ctx,
      )
      return "skipped"
    }

    let result
    try {
      result = await emailService.sendAppointmentReminder({
        email: emailPlain,
        dateTime: dateTimeFormatted,
        location: appt.location,
        appointmentId: appt.id,
        language,
      })
    } catch (err) {
      const msg = sanitizeProviderError(
        err instanceof Error ? err.message : "unknown",
        emailPlain,
      )
      await this.persistReminder(
        appt.id, stepCfg, "failed", emailPlain, null, msg,
        appt.patientId, ctx,
      )
      return "failed"
    }

    if (!result.sent) {
      const sanitized = sanitizeProviderError(result.error ?? "unknown", emailPlain)
      await this.persistReminder(
        appt.id, stepCfg, "failed", emailPlain, null, sanitized,
        appt.patientId, ctx,
      )
      return "failed"
    }
    await this.persistReminder(
      appt.id, stepCfg, "sent", emailPlain, result.id ?? null, null,
      appt.patientId, ctx,
    )
    return "sent"
  },

  // ─── Channel : SMS J-1 (US-2506 mock V1) ───────────────────────
  async sendSmsReminder(
    appt: {
      id: number; patientId: number; date: Date; hour: Date | null;
      member: { serviceId: number | null } | null
      patient: { user: { phone: string | null } }
    },
    stepCfg: ReminderStepConfig,
    dateTimeFormatted: string,
    language: AllowedLanguage,
    ctx: AuditContext,
  ): Promise<ResultKind> {
    if (!appt.member?.serviceId) {
      await this.persistReminder(
        appt.id, stepCfg, "skipped", null, null, "no_cabinet",
        appt.patientId, ctx,
      )
      return "skipped"
    }
    if (!appt.patient.user.phone) {
      await this.persistReminder(
        appt.id, stepCfg, "skipped", null, null, "no_phone",
        appt.patientId, ctx,
      )
      return "skipped"
    }
    const phonePlain = safeDecryptField(appt.patient.user.phone)
    if (!phonePlain) {
      await this.persistReminder(
        appt.id, stepCfg, "skipped", null, null, "phone_decrypt_failed",
        appt.patientId, ctx,
      )
      return "skipped"
    }

    // Message anti-PHI strict (date+heure uniquement, pas de nom/médecin/lieu).
    const msgFr = `Rappel Diabeo : rendez-vous demain ${dateTimeFormatted}. Annulation possible via l'application.`
    const msgEn = `Diabeo reminder: appointment tomorrow ${dateTimeFormatted}. Cancel via the app if needed.`
    const msgAr = `تذكير Diabeo: موعد غدا ${dateTimeFormatted}. الإلغاء عبر التطبيق إذا لزم الأمر.`
    const msg = language === "en" ? msgEn : language === "ar" ? msgAr : msgFr

    try {
      const result = await smsService.sendSms(
        {
          cabinetId: appt.member.serviceId,
          to: phonePlain,
          message: msg,
          contextKind: "appointment_reminder",
          creditCost: 1,
        },
        CRON_AUDIT_USER_ID,
        ctx,
        { patientId: appt.patientId, appointmentId: appt.id },
      )
      if (result.sent) {
        await this.persistReminder(
          appt.id, stepCfg, "sent", phonePlain, result.providerMessageId, null,
          appt.patientId, ctx,
        )
        return "sent"
      }
      // Should not reach here — sendSms throws on failure.
      await this.persistReminder(
        appt.id, stepCfg, "failed", phonePlain, null, result.error ?? "unknown",
        appt.patientId, ctx,
      )
      return "failed"
    } catch (err) {
      if (err instanceof SmsDisabledError) {
        await this.persistReminder(
          appt.id, stepCfg, "skipped", phonePlain, null, "cabinet_sms_disabled",
          appt.patientId, ctx,
        )
        return "skipped"
      }
      if (err instanceof SmsInsufficientCreditError) {
        await this.persistReminder(
          appt.id, stepCfg, "skipped", phonePlain, null, "insufficient_credits",
          appt.patientId, ctx,
        )
        return "skipped"
      }
      if (err instanceof SmsValidationError) {
        await this.persistReminder(
          appt.id, stepCfg, "skipped", phonePlain, null, `sms_validation:${err.field}`,
          appt.patientId, ctx,
        )
        return "skipped"
      }
      const msg = sanitizeProviderError(
        err instanceof Error ? err.message : "unknown",
        phonePlain,
      )
      await this.persistReminder(
        appt.id, stepCfg, "failed", phonePlain, null, msg,
        appt.patientId, ctx,
      )
      return "failed"
    }
  },

  // ─── Channel : push J-0 (FCM) ───────────────────────────────────
  async sendPushReminder(
    appt: {
      id: number; patientId: number;
      patient: { user: { id: number } }
    },
    stepCfg: ReminderStepConfig,
    dateTimeFormatted: string,
    language: AllowedLanguage,
    ctx: AuditContext,
  ): Promise<ResultKind> {
    const titleFr = "Rendez-vous aujourd'hui"
    const titleEn = "Appointment today"
    const titleAr = "موعد اليوم"
    const title = language === "en" ? titleEn : language === "ar" ? titleAr : titleFr

    const bodyFr = `Votre rendez-vous est prévu à ${dateTimeFormatted.split(" ").pop() ?? ""}`
    const bodyEn = `Your appointment is scheduled at ${dateTimeFormatted.split(" ").pop() ?? ""}`
    const bodyAr = `موعدك مبرمج في ${dateTimeFormatted.split(" ").pop() ?? ""}`
    const body = language === "en" ? bodyEn : language === "ar" ? bodyAr : bodyFr

    try {
      // FCM accepte un senderId — pour les events cron sans User, on emule
      // un acteur système (sentinel 0 documente pour FCM uniquement,
      // pas pour audit).
      const result = await fcmService.sendToUser(
        {
          userId: appt.patient.user.id,
          senderId: 0,
          title,
          body,
          data: {
            kind: "appointment_reminder",
            appointmentId: String(appt.id),
          },
        },
        ctx,
      )
      if (result.sent === 0 && result.failed === 0) {
        // Aucun device enregistre.
        await this.persistReminder(
          appt.id, stepCfg, "skipped", null, null, "no_fcm_token",
          appt.patientId, ctx,
        )
        return "skipped"
      }
      if (result.sent > 0) {
        await this.persistReminder(
          appt.id, stepCfg, "sent", null,
          result.results[0]?.registrationId ?? null, null,
          appt.patientId, ctx,
        )
        return "sent"
      }
      const firstErr = result.results.find((r) => r.error)?.error ?? "fcm_failed"
      await this.persistReminder(
        appt.id, stepCfg, "failed", null, null, firstErr,
        appt.patientId, ctx,
      )
      return "failed"
    } catch (err) {
      const msg = sanitizeProviderError(
        err instanceof Error ? err.message : "unknown",
        null,
      )
      await this.persistReminder(
        appt.id, stepCfg, "failed", null, null, msg,
        appt.patientId, ctx,
      )
      return "failed"
    }
  },

  /**
   * Persist AppointmentReminder + audit en transaction.
   * Recheck status appointment + P2002 catch silent skip.
   *
   * @internal
   */
  async persistReminder(
    appointmentId: number,
    stepCfg: ReminderStepConfig,
    status: ResultKind,
    recipientPlain: string | null,
    providerMessageId: string | null,
    errorMessage: string | null,
    patientId: number,
    ctx: AuditContext,
  ): Promise<void> {
    const sentToEnc = recipientPlain ? encryptField(recipientPlain) : null
    try {
      await prisma.$transaction(async (tx) => {
        // Recheck status (TOCTOU cancelled/completed entre findMany et persist).
        const fresh = await tx.appointment.findUnique({
          where: { id: appointmentId },
          select: { status: true },
        })
        if (!fresh || (fresh.status !== "scheduled" && fresh.status !== "confirmed")) {
          logger.warn(
            "appointment-reminder",
            "status changed during run",
            { resource: "APPOINTMENT_REMINDER" },
          )
          return
        }
        await tx.appointmentReminder.create({
          data: {
            appointmentId,
            channel: stepCfg.channel,
            step: stepCfg.step,
            status,
            sentToEnc,
            providerMessageId,
            errorMessage,
          },
        })
        const auditKind = status === "sent"
          ? AUDIT_KIND.SENT
          : status === "failed"
            ? AUDIT_KIND.FAILED
            : AUDIT_KIND.SKIPPED
        await auditService.logWithTx(tx, {
          userId: CRON_AUDIT_USER_ID,
          action: "CREATE",
          resource: "APPOINTMENT_REMINDER",
          resourceId: String(appointmentId),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: {
            kind: auditKind,
            channel: stepCfg.channel,
            step: stepCfg.step,
            patientId, // US-2268 pivot
            ...(providerMessageId && { providerMessageId }),
            ...(errorMessage && { errorReason: errorMessage }),
          },
        })
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError
        && e.code === "P2002"
      ) {
        logger.debug?.(
          "appointment-reminder",
          "idempotent skip",
          { resource: "APPOINTMENT_REMINDER", kind: "duplicate" },
        )
        return
      }
      throw e
    }
  },
}
