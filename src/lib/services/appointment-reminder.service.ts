/**
 * @module services/appointment-reminder
 * @description US-2502 — Rappels RDV multi-canal (Batch 2 Groupe 8 RDV).
 *
 * Cron quotidien : push J-0 (priorité critique) / SMS J-1 / email J-2.
 *
 * ### Architecture round 3 review
 *
 *   - **CR-1** : advisory lock SESSION-level via `withSessionAdvisoryLock`
 *     (pool pg dédié max:1) — garantit que acquire et release tournent sur
 *     la **même** connexion physique. Le round 2 utilisait `prisma.$queryRaw`
 *     qui pouvait router acquire/release sur des connexions différentes du
 *     pool partagé → release no-op silencieux → lock orphelin → cron bloqué.
 *   - **HI-1** : filtre `notifPreferences` accepte `null OR true` (l'opt-in
 *     implicite est respecté ; round 2 excluait à tort les patients sans
 *     préférences explicites = majorité prod).
 *   - **HI-2** : SMS mock V1 persiste `status="skipped"` (vs round 2 `"sent"`
 *     mensonger) avec `errorReason="provider_mock_no_real_sms"` → médecin
 *     voit la réalité dans la timeline.
 *   - **MED-1** : compter opt-outs RGPD Art. 21 dans audit `cron.run`
 *     metadata.optOutSkipped → démonstrabilité CNIL Art. 5.2.
 *   - **MED-5** : `User.timezone` retiré du SELECT (dead code V1).
 *   - **LOW-2** : marker U+200F (RLM) en début string arabe push body.
 *   - **LOW-4** : `extraMetadata` typé `ExtraReminderMetadata` strict.
 *
 * ### Heritage rounds précédents (round 2)
 *
 *   - **C1** : `formatDateTime` `timeZone: "UTC"` + composantes UTC →
 *     rendu fidèle "14:00 stocké" → "14:00 affiché".
 *   - **C2** : `senderId: null` passé à `fcmService.sendToUser` (FK-safe).
 *   - **M10** : ordre steps inversé — push J-0 first, SMS J-1, email J-2.
 *   - **M11** : `runId` UUID + `resourceId: String(appointmentId)` US-2268.
 *   - **M12/M13** : null handling `location` / `hour`.
 *   - **M1** : push partial errors → metadata.recipientCount/sent/failed.
 *
 * ### Channels
 *
 *   - **push J-0** via `fcmService.sendToUser` (data-only, sans PHI).
 *   - **sms J-1** via `smsService.sendSms` (mock V1 US-2506).
 *   - **email J-2** via Resend (US-2074).
 *
 * ### Idempotence absolue
 *
 * `@@unique([appointmentId, channel, step])` empêche envoi double.
 * Advisory lock global session anti double-trigger cron concurrents.
 *
 * ### Sécurité HDS / RGPD
 *
 *   - `sentToEnc` chiffré AES-256-GCM.
 *   - `metadata.patientId + appointmentId` US-2268 forensique.
 *   - Filtre RGPD Art. 17 + Art. 21 + `status IN [scheduled, confirmed]`.
 *   - Audit `userId: null` sentinel système cron (FK-safe).
 */

import { Prisma } from "@prisma/client"
import type {
  AppointmentReminderChannel,
  AppointmentReminderStep,
} from "@prisma/client"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/db/client"
import { withSessionAdvisoryLock } from "@/lib/db/cron-lock"
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

/**
 * M10 round 2 review — ordre inversé : J-0 push (critique) en premier,
 * puis J-1 SMS, puis J-2 email en dernier (lag-tolérant). Évite que le
 * email step (Resend lag possible) consomme tout le timeout 50s et que
 * SMS/push J-0 soient skippés.
 */
export const APPOINTMENT_REMINDER_STEPS: readonly ReminderStepConfig[] = [
  { step: "j_0", channel: "push", daysBeforeDate: 0 },
  { step: "j_minus_1", channel: "sms", daysBeforeDate: 1 },
  { step: "j_minus_2", channel: "email", daysBeforeDate: 2 },
] as const

export const MAX_APPOINTMENTS_PER_STEP = 500
const CRON_TIMEOUT_MS = 50_000
const PARALLEL_CONCURRENCY = 10

/**
 * C1 round 2 review — Timezone par défaut pour interpréter
 * `Appointment.hour @db.Time()` (stocké timezone-less = local cabinet).
 * Fallback `User.timezone` si renseigné (Algérie etc.).
 */
const DEFAULT_CLINIC_TIMEZONE = "Europe/Paris"

// C2 round 2 — sentinel système cron (FK-safe via `senderId: number | null`).
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
  runId: string
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function emptyMetrics(runId: string): ApptReminderRunMetrics {
  return {
    processed: 0, sent: 0, failed: 0, skipped: 0,
    timedOut: false, skippedConcurrent: false,
    byChannel: {
      email: { sent: 0, failed: 0, skipped: 0 },
      sms: { sent: 0, failed: 0, skipped: 0 },
      push: { sent: 0, failed: 0, skipped: 0 },
    },
    runId,
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

/**
 * C1 round 2 — Format date+heure avec timezone pinned `UTC` côté Intl
 * pour rendu FIDÈLE de l'heure stockée timezone-less.
 *
 * Contrat de stockage :
 *   - `Appointment.date @db.Date` (date naïve)
 *   - `Appointment.hour @db.Time()` (heure naïve, sans TZ)
 *   Les deux sont en **heure locale cabinet** (par convention Europe/Paris).
 *
 * Problème C1 fixé :
 *   - Sans `timeZone` explicite, Intl utilise la TZ du runtime Node →
 *     prod Docker UTC : "14:00 stocké" rendu "14:00" ; dev Paris : "16:00".
 *   - Avec `timeZone: "Europe/Paris"`, Intl convertit le timestamp absolu
 *     (interprété UTC) vers Paris : "14:00 stocké" → "16:00 affiché" été.
 *   - Solution : `timeZone: "UTC"` côté Intl + on garde le timestamp comme
 *     `Date.UTC(y, m, d, hh, mm)` → "14:00 stocké" → "14:00 affiché" fidèle.
 *
 * Le paramètre `timezone` est conservé pour usage futur (V1.5+ : conversion
 * vers TZ patient si différente de la TZ cabinet, e.g. patient voyageur).
 * En V1, on rend l'heure exacte stockée (timezone cabinet implicite).
 *
 * @param timezone Conservé pour V1.5 (cf. User.timezone). Inutilisé V1.
 */
function formatDateTime(
  date: Date,
  hour: Date | null,
  language: AllowedLanguage,
  _timezone: string = DEFAULT_CLINIC_TIMEZONE,
): { datePart: string; timePart: string | null } {
  const locale = language === "ar" ? "ar-DZ" : language === "en" ? "en-US" : "fr-FR"

  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const d = date.getUTCDate()
  const hh = hour?.getUTCHours() ?? 0
  const mm = hour?.getUTCMinutes() ?? 0

  // Construit comme UTC pour éviter offset runtime, rendu en UTC pour fidélité.
  const combined = new Date(Date.UTC(y, m, d, hh, mm, 0, 0))

  let datePart: string
  try {
    datePart = new Intl.DateTimeFormat(locale, {
      day: "numeric", month: "long", year: "numeric",
      timeZone: "UTC",
    }).format(combined)
  } catch {
    datePart = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  }

  if (!hour) return { datePart, timePart: null }

  let timePart: string
  try {
    timePart = new Intl.DateTimeFormat(locale, {
      hour: "2-digit", minute: "2-digit",
      timeZone: "UTC",
      hourCycle: "h23",
    }).format(combined)
  } catch {
    timePart = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
  }

  return { datePart, timePart }
}

function combineDateTimeLabel(
  parts: { datePart: string; timePart: string | null },
  language: AllowedLanguage,
): string {
  if (!parts.timePart) return parts.datePart
  if (language === "ar") {
    // LOW-2 round 3 — préfixe U+200F (RLM = RIGHT-TO-LEFT MARK) pour
    // forcer le rendu RTL des notifications push (certains clients
    // Android/iOS rendent la concat LTR par défaut, brisant le sens).
    return `‏${parts.datePart} في ${parts.timePart}`
  }
  const sep = language === "fr" ? "à" : "at"
  return `${parts.datePart} ${sep} ${parts.timePart}`
}

/**
 * M9 round 2 — Sanitize provider error : scrub emails + phones FR+E164.
 */
function sanitizeProviderError(msg: string, sensitive: string | null): string {
  // Cap longueur AVANT regex pour limiter consommation mémoire.
  let s = msg.slice(0, 2000)
  if (sensitive && sensitive.length > 0) {
    const escaped = sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    s = s.replace(new RegExp(escaped, "gi"), "<recipient>")
  }
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "<recipient>")
  s = s.replace(/\+\d{8,15}/g, "<phone>")
  // M9 round 2 — numéros FR locaux (sans +).
  s = s.replace(/\b0\d{9}\b/g, "<phone>")
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
// Advisory lock — voir `src/lib/db/cron-lock.ts`
// ─────────────────────────────────────────────────────────────

export const CRON_LOCK_KEY = "appointment-reminder-cron"

// ─────────────────────────────────────────────────────────────
// Metadata typing strict (LOW-4 round 3)
// ─────────────────────────────────────────────────────────────

/**
 * LOW-4 round 3 — metadata extension typée strictement. Empêche un futur
 * dev de leak PHI (`phoneFull`, `nirpp`, etc.) dans audit_logs via une
 * extension `Record<string, unknown>` permissive.
 */
type ExtraReminderMetadata =
  | { recipientCount: number; sent: number; failed: number }
  | Record<string, never>

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export const appointmentReminderService = {
  /**
   * Cron entrypoint quotidien.
   *
   * Round 3 architecture (CR-1) :
   *   1. Advisory lock SESSION via `withSessionAdvisoryLock` (pool dédié
   *      max:1 → acquire et release garantis sur la même connexion).
   *   2. Pour chaque step (J-0 push first → J-2 email last) :
   *      - findMany via `prisma` (pool partagé)
   *      - parallel send via p-limit + Promise.allSettled
   *      - chaque persist se fait dans sa propre tx courte
   *   3. Audit cron.run dans une tx finale séparée (best-effort).
   *   4. Release advisory lock garanti par `withSessionAdvisoryLock`.
   */
  async processAppointmentReminders(
    now: Date,
    ctx: AuditContext,
  ): Promise<ApptReminderRunMetrics> {
    const runId = randomUUID()
    const metrics = emptyMetrics(runId)
    const t0 = Date.now()

    const result = await withSessionAdvisoryLock(CRON_LOCK_KEY, async () => {
      const limit = pLimit<ResultKind>(PARALLEL_CONCURRENCY)
      // MED-1 round 3 — compteur opt-outs RGPD Art. 21 (démonstrabilité CNIL).
      let optOutSkippedTotal = 0

      for (const stepCfg of APPOINTMENT_REMINDER_STEPS) {
        if (Date.now() - t0 > CRON_TIMEOUT_MS) {
          metrics.timedOut = true
          break
        }
        const targetDate = new Date(now)
        targetDate.setUTCDate(targetDate.getUTCDate() + stepCfg.daysBeforeDate)
        targetDate.setUTCHours(0, 0, 0, 0)
        const nextDate = new Date(targetDate)
        nextDate.setUTCDate(nextDate.getUTCDate() + 1)

        // MED-1 round 3 — count opt-outs avant findMany pour audit.
        // Le coût est marginal (count partial sur l'index) et permet
        // démonstrabilité CNIL Art. 5.2 sans révéler identité patient.
        const optOutCount = await prisma.appointment.count({
          where: {
            status: { in: ["scheduled", "confirmed"] },
            date: { gte: targetDate, lt: nextDate },
            reminders: {
              none: { channel: stepCfg.channel, step: stepCfg.step },
            },
            patient: {
              deletedAt: null,
              user: {
                status: "active",
                notifPreferences: { medicalAppointments: false },
              },
            },
          },
        })
        optOutSkippedTotal += optOutCount

        // HI-1 round 3 — opt-in implicite respecté : patient sans row
        // `UserNotifPreferences` est traité comme `medicalAppointments=true`
        // (défaut conforme `prisma/schema.prisma:UserNotifPreferences`). Round
        // 2 utilisait juste `{ medicalAppointments: true }` → EXISTS SQL qui
        // excluait à tort la majorité des patients en prod (préférences
        // créées lazily au 1er PUT, GET ne persiste pas).
        const appointments = await prisma.appointment.findMany({
          where: {
            status: { in: ["scheduled", "confirmed"] },
            date: { gte: targetDate, lt: nextDate },
            reminders: {
              none: { channel: stepCfg.channel, step: stepCfg.step },
            },
            patient: {
              deletedAt: null,
              user: {
                status: "active",
                OR: [
                  { notifPreferences: null },
                  { notifPreferences: { medicalAppointments: true } },
                ],
              },
            },
          },
          select: {
            id: true,
            patientId: true,
            date: true,
            hour: true,
            location: true,
            member: {
              select: { serviceId: true },
            },
            patient: {
              select: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    phone: true,
                    language: true,
                    // MED-5 round 3 — `timezone` retiré du SELECT (dead code
                    // V1 — `formatDateTime` ignore le param `_timezone`).
                    // Sera réintroduit V1.5 si on implémente conversion TZ
                    // patient (voyageur).
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
            limit(() => this.sendReminderForAppointment(appt, stepCfg, runId, ctx)),
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
      // Audit cron.run final dans sa propre tx (best-effort, hors lock).
      await auditService.log({
        userId: CRON_AUDIT_USER_ID,
        action: "CREATE",
        resource: "APPOINTMENT_REMINDER",
        resourceId: runId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          kind: auditKind,
          runId,
          processed: metrics.processed,
          sent: metrics.sent,
          failed: metrics.failed,
          skipped: metrics.skipped,
          // MED-1 round 3 — count anonyme opt-outs (RGPD Art. 21
          // démonstrabilité CNIL).
          optOutSkipped: optOutSkippedTotal,
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

    // CR-1 round 3 — `withSessionAdvisoryLock` retourne `null` si lock non
    // acquis. Sinon retourne le résultat du callback.
    if (result === null) {
      metrics.skippedConcurrent = true
      await auditService.log({
        userId: CRON_AUDIT_USER_ID,
        action: "CREATE",
        resource: "APPOINTMENT_REMINDER",
        resourceId: runId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { kind: AUDIT_KIND.CRON_SKIPPED_LOCKED, runId },
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

    return result
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
    runId: string,
    ctx: AuditContext,
  ): Promise<ResultKind> {
    const language = normalizeLanguage(appt.patient.user.language)
    // MED-5 round 3 — `timezone` retiré (formatDateTime ignore le param V1).
    const dtParts = formatDateTime(appt.date, appt.hour, language)

    if (stepCfg.channel === "email") {
      return this.sendEmailReminder(appt, stepCfg, dtParts, language, runId, ctx)
    }
    if (stepCfg.channel === "sms") {
      return this.sendSmsReminder(appt, stepCfg, dtParts, language, runId, ctx)
    }
    return this.sendPushReminder(appt, stepCfg, dtParts, language, runId, ctx)
  },

  // ─── Channel : email J-2 ───────────────────────────────────────
  async sendEmailReminder(
    appt: {
      id: number; patientId: number; date: Date; hour: Date | null;
      location: "in_person" | "video" | "phone" | null
      patient: { user: { email: string } }
    },
    stepCfg: ReminderStepConfig,
    dtParts: { datePart: string; timePart: string | null },
    language: AllowedLanguage,
    runId: string,
    ctx: AuditContext,
  ): Promise<ResultKind> {
    const emailPlain = safeDecryptField(appt.patient.user.email)
    if (!emailPlain) {
      await this.persistReminder(
        appt.id, stepCfg, "skipped", null, null, "email_decrypt_failed",
        appt.patientId, runId, ctx,
      )
      return "skipped"
    }

    const dateTimeLabel = combineDateTimeLabel(dtParts, language)

    let result
    try {
      result = await emailService.sendAppointmentReminder({
        email: emailPlain,
        dateTime: dateTimeLabel,
        location: appt.location, // M12 — null handling dans le template
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
        appt.patientId, runId, ctx,
      )
      return "failed"
    }

    if (!result.sent) {
      const sanitized = sanitizeProviderError(result.error ?? "unknown", emailPlain)
      await this.persistReminder(
        appt.id, stepCfg, "failed", emailPlain, null, sanitized,
        appt.patientId, runId, ctx,
      )
      return "failed"
    }
    await this.persistReminder(
      appt.id, stepCfg, "sent", emailPlain, result.id ?? null, null,
      appt.patientId, runId, ctx,
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
    dtParts: { datePart: string; timePart: string | null },
    language: AllowedLanguage,
    runId: string,
    ctx: AuditContext,
  ): Promise<ResultKind> {
    if (!appt.member?.serviceId) {
      await this.persistReminder(
        appt.id, stepCfg, "skipped", null, null, "no_cabinet",
        appt.patientId, runId, ctx,
      )
      return "skipped"
    }
    if (!appt.patient.user.phone) {
      await this.persistReminder(
        appt.id, stepCfg, "skipped", null, null, "no_phone",
        appt.patientId, runId, ctx,
      )
      return "skipped"
    }

    // H4 round 2 — V1 mock : pas besoin de déchiffrer pour valider.
    // En V3 real Twilio, refactorer pour déchiffrer juste avant le call provider.
    const phonePlain = safeDecryptField(appt.patient.user.phone)
    if (!phonePlain) {
      await this.persistReminder(
        appt.id, stepCfg, "skipped", null, null, "phone_decrypt_failed",
        appt.patientId, runId, ctx,
      )
      return "skipped"
    }

    // Message anti-PHI strict (date+heure uniquement).
    const dateTimeLabel = combineDateTimeLabel(dtParts, language)
    const msgFr = `Rappel Diabeo : rendez-vous demain ${dateTimeLabel}. Annulation possible via l'application.`
    const msgEn = `Diabeo reminder: appointment tomorrow ${dateTimeLabel}. Cancel via the app if needed.`
    const msgAr = `تذكير Diabeo: موعد غدا ${dateTimeLabel}. الإلغاء عبر التطبيق إذا لزم الأمر.`
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
        // HI-2 round 3 — distinguer "mock" V1 (aucun SMS réellement envoyé)
        // de "sent" réel (V3 Twilio/OVH). Le médecin verra dans la timeline
        // patient `status="skipped"` + `errorReason="provider_mock_no_real_sms"`
        // → ne croira pas le patient prévenu (vs round 2 qui mentait).
        if (result.status === "mock") {
          await this.persistReminder(
            appt.id, stepCfg, "skipped", phonePlain, result.providerMessageId,
            "provider_mock_no_real_sms",
            appt.patientId, runId, ctx,
          )
          return "skipped"
        }
        await this.persistReminder(
          appt.id, stepCfg, "sent", phonePlain, result.providerMessageId, null,
          appt.patientId, runId, ctx,
        )
        return "sent"
      }
      await this.persistReminder(
        appt.id, stepCfg, "failed", phonePlain, null, result.error ?? "unknown",
        appt.patientId, runId, ctx,
      )
      return "failed"
    } catch (err) {
      if (err instanceof SmsDisabledError) {
        await this.persistReminder(
          appt.id, stepCfg, "skipped", phonePlain, null, "cabinet_sms_disabled",
          appt.patientId, runId, ctx,
        )
        return "skipped"
      }
      if (err instanceof SmsInsufficientCreditError) {
        await this.persistReminder(
          appt.id, stepCfg, "skipped", phonePlain, null, "insufficient_credits",
          appt.patientId, runId, ctx,
        )
        return "skipped"
      }
      if (err instanceof SmsValidationError) {
        await this.persistReminder(
          appt.id, stepCfg, "skipped", phonePlain, null, `sms_validation:${err.field}`,
          appt.patientId, runId, ctx,
        )
        return "skipped"
      }
      const msg = sanitizeProviderError(
        err instanceof Error ? err.message : "unknown",
        phonePlain,
      )
      await this.persistReminder(
        appt.id, stepCfg, "failed", phonePlain, null, msg,
        appt.patientId, runId, ctx,
      )
      return "failed"
    }
  },

  // ─── Channel : push J-0 (FCM) ───────────────────────────────────
  async sendPushReminder(
    appt: {
      id: number; patientId: number; hour: Date | null;
      patient: { user: { id: number } }
    },
    stepCfg: ReminderStepConfig,
    dtParts: { datePart: string; timePart: string | null },
    language: AllowedLanguage,
    runId: string,
    ctx: AuditContext,
  ): Promise<ResultKind> {
    const titleFr = "Rendez-vous aujourd'hui"
    const titleEn = "Appointment today"
    const titleAr = "موعد اليوم"
    const title = language === "en" ? titleEn : language === "ar" ? titleAr : titleFr

    // M13 round 2 — hour IS NULL → body sans heure (vs ancien "à 2026").
    let body: string
    if (dtParts.timePart) {
      const bodyFr = `Votre rendez-vous est prévu à ${dtParts.timePart}`
      const bodyEn = `Your appointment is scheduled at ${dtParts.timePart}`
      const bodyAr = `موعدك مبرمج في ${dtParts.timePart}`
      body = language === "en" ? bodyEn : language === "ar" ? bodyAr : bodyFr
    } else {
      const bodyFr = "Votre rendez-vous est prévu aujourd'hui"
      const bodyEn = "Your appointment is scheduled today"
      const bodyAr = "موعدك مبرمج اليوم"
      body = language === "en" ? bodyEn : language === "ar" ? bodyAr : bodyFr
    }

    try {
      // C2 round 2 — senderId: null sentinel système (fcm.service accepte
      // number | null désormais, FK-safe pour audit_logs.user_id).
      const result = await fcmService.sendToUser(
        {
          userId: appt.patient.user.id,
          senderId: CRON_AUDIT_USER_ID,
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
        await this.persistReminder(
          appt.id, stepCfg, "skipped", null, null, "no_fcm_token",
          appt.patientId, runId, ctx,
        )
        return "skipped"
      }
      if (result.sent > 0) {
        // M1 round 2 — propage recipientCount/sent/failed dans audit
        // metadata pour traçabilité partial errors par device.
        await this.persistReminder(
          appt.id, stepCfg, "sent", null,
          result.results[0]?.registrationId ?? null, null,
          appt.patientId, runId, ctx,
          { recipientCount: result.results.length, sent: result.sent, failed: result.failed },
        )
        return "sent"
      }
      const firstErr = result.results.find((r) => r.error)?.error ?? "fcm_failed"
      await this.persistReminder(
        appt.id, stepCfg, "failed", null, null, firstErr,
        appt.patientId, runId, ctx,
        { recipientCount: result.results.length, sent: result.sent, failed: result.failed },
      )
      return "failed"
    } catch (err) {
      const msg = sanitizeProviderError(
        err instanceof Error ? err.message : "unknown",
        null,
      )
      await this.persistReminder(
        appt.id, stepCfg, "failed", null, null, msg,
        appt.patientId, runId, ctx,
      )
      return "failed"
    }
  },

  /**
   * Persist AppointmentReminder + audit en transaction COURTE.
   *
   * Round 2 (C3) : tx isolée par reminder → ne dépend plus de l'outer
   * advisory_xact_lock. Le lock SESSION-level garantit l'unicité du run
   * (pas du persist per-reminder, qui est UNIQUE-protected).
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
    runId: string,
    ctx: AuditContext,
    extraMetadata: ExtraReminderMetadata = {} as ExtraReminderMetadata,
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
          resourceId: String(appointmentId), // M11 — ID natif (vs sentinel)
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: {
            kind: auditKind,
            channel: stepCfg.channel,
            step: stepCfg.step,
            patientId, // US-2268 pivot
            runId, // M11 — groupement par run
            ...(providerMessageId && { providerMessageId }),
            ...(errorMessage && { errorReason: errorMessage }),
            ...extraMetadata, // M1 — recipientCount/sent/failed pour push
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
