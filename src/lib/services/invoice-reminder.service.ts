/**
 * @module services/invoice-reminder
 * @description US-2108 — Relances factures automatiques (Batch 4 Facturation).
 *
 * Cron J+7 / J+15 / J+30 via Resend (email service US-2074).
 *
 * ### Architecture round 2 review
 *
 *   - **C1** : `CRON_AUDIT_USER_ID = null` (pas 0 → FK violation users.id).
 *   - **C2** : enum names snake_case (cf. migration).
 *   - **H1** : filtre `patient.deletedAt: null` + `user.status: 'active'`
 *     (RGPD Art. 17 — pas de relance a patient soft-deleted).
 *   - **H3** : `p-limit(10)` parallelisme + timeout 50s break (anti
 *     Next.js timeout 60s).
 *   - **H4** : `sanitizeResendError(msg, email)` scrub email plaintext
 *     dans errorMessage (anti PII leak Resend echo).
 *   - **H5** : `pg_try_advisory_xact_lock` global cron (anti double-run
 *     OVH+Vercel simultanes → double email patient).
 *   - **H8** : `metadata.patientId` propage (US-2268 forensique CNIL/ANS).
 *   - **M3** : recheck `status === issued` dans la tx persistReminder
 *     (TOCTOU paid/cancelled entre findMany et send).
 *   - **M7** : audit `.catch()` log structure (pas silent).
 *   - **M8** : `MAX_INVOICES_PER_STEP` renomme (vs `_PER_RUN` trompeur).
 *   - **M9** : `orderBy: { issuedAt: 'asc' }` (priorise les plus anciennes).
 *
 * ### Idempotence absolue
 *
 * `@@unique([invoiceId, step])` empeche envoi double. P2002 catch =
 * silent skip (cron retry safe). L'advisory lock H5 ajoute une couche
 * supplementaire anti double-trigger cron concurrents.
 *
 * ### Hors scope V1 (TODOs documentes)
 *
 *   - M5 : Personnaliser FROM/Reply-To par cabinet (LCEN Art. 6 + CGI
 *     L.441-10 mentions intérêts retard + indemnité 40€) — V1.5.
 *   - M6 : `Invoice.dueDate` colonne (vs cron calcule J+N depuis issuedAt
 *     qui n'est pas la vraie échéance comptable) — V1.5.
 *   - Notifications cabinet-interne (invoice sans patient) → V1.5.
 *   - SMS (US-2506 procurement Twilio) → V2.
 *   - Webhooks Resend `email.bounced` / `email.delivered` → V2.
 */

import { Prisma } from "@prisma/client"
import type { InvoiceReminderStep } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService, type AuditContext } from "./audit.service"
import { emailService } from "./email.service"
import { logger } from "@/lib/logger"

// ─────────────────────────────────────────────────────────────
// Configuration cron — delais en jours par step.
// ─────────────────────────────────────────────────────────────

export const REMINDER_STEPS = [
  { step: "step_7" as const, delayDays: 7 },
  { step: "step_15" as const, delayDays: 15 },
  { step: "step_30" as const, delayDays: 30 },
] as const

/**
 * M8 round 2 — renomme de `_PER_RUN` qui etait trompeur. C'est un cap
 * PAR STEP : 3 steps × 500 = 1500 invoices max/run au total (theorique).
 */
export const MAX_INVOICES_PER_STEP = 500

/**
 * H3 round 2 — timeout global cron run (50s, sous Next.js 60s).
 * Si depasse, on break + l'idempotence laisse les invoices restantes
 * pour le run suivant.
 */
const CRON_TIMEOUT_MS = 50_000

/**
 * H3 round 2 — concurrence parallel pour Resend send + persist.
 * 10 simultanes = ~5× gain wall-clock sans surcharge Resend free tier.
 */
const PARALLEL_CONCURRENCY = 10

// ─────────────────────────────────────────────────────────────
// Audit kinds.
// ─────────────────────────────────────────────────────────────

export type ReminderAuditKind =
  | "invoice.reminder.sent"
  | "invoice.reminder.failed"
  | "invoice.reminder.skipped"
  | "invoice.reminder.cron.run"
  | "invoice.reminder.cron.skipped_locked"
  | "invoice.reminder.cron.timeout"

const AUDIT_KIND = {
  SENT: "invoice.reminder.sent",
  FAILED: "invoice.reminder.failed",
  SKIPPED: "invoice.reminder.skipped",
  CRON_RUN: "invoice.reminder.cron.run",
  CRON_SKIPPED_LOCKED: "invoice.reminder.cron.skipped_locked",
  CRON_TIMEOUT: "invoice.reminder.cron.timeout",
} as const satisfies Record<string, ReminderAuditKind>

export { AUDIT_KIND as REMINDER_AUDIT_KIND }

// ─────────────────────────────────────────────────────────────
// Result types.
// ─────────────────────────────────────────────────────────────

type ResultKind = "sent" | "failed" | "skipped"

export interface ReminderRunMetrics {
  processed: number
  sent: number
  failed: number
  skipped: number
  byStep: Record<InvoiceReminderStep, { sent: number; failed: number; skipped: number }>
  /** H3 round 2 — true si run interrompu par timeout 50s. */
  timedOut: boolean
  /** H5 round 2 — true si advisory lock pris par un autre run concurrent. */
  skippedConcurrent: boolean
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * C1 round 2 review — sentinel cron = `null` (pas `0` qui violait FK
 * `audit_logs.user_id → users.id`). Toutes les insertions audit doivent
 * propager `null` pour evenements systeme (cron, worker).
 */
const CRON_AUDIT_USER_ID = null as number | null

function emptyMetrics(): ReminderRunMetrics {
  const byStep = Object.fromEntries(
    REMINDER_STEPS.map(({ step }) => [step, { sent: 0, failed: 0, skipped: 0 }]),
  ) as ReminderRunMetrics["byStep"]
  return {
    processed: 0, sent: 0, failed: 0, skipped: 0,
    timedOut: false, skippedConcurrent: false,
    byStep,
  }
}

/**
 * M4 round 2 — fallback localisation safe si full-icu absent.
 * `Intl.NumberFormat`/`DateTimeFormat` tombe sur en-US si full-icu pas
 * installe → format `$120.00` au lieu de `120,00 €`. Safe : on retourne
 * la valeur brute lisible.
 */
function formatAmount(totalCents: number, currency: string, language: "fr" | "en" | "ar"): string {
  const amount = totalCents / 100
  const locale = language === "ar" ? "ar-DZ" : language === "en" ? "en-US" : "fr-FR"
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function formatDate(date: Date, language: "fr" | "en" | "ar"): string {
  const locale = language === "ar" ? "ar-DZ" : language === "en" ? "en-US" : "fr-FR"
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(date)
  } catch {
    // L4 round 2 — fallback ISO YYYY-MM-DD (mieux que "" vide).
    return date.toISOString().split("T")[0] ?? date.toISOString()
  }
}

/**
 * H4 round 2 review — Resend echo l'email destinataire dans certaines
 * erreurs (ex. `"Invalid email: john@example.com"`). Scrub plaintext.
 */
function sanitizeResendError(msg: string, emailPlain: string | null): string {
  let sanitized = msg
  if (emailPlain && emailPlain.length > 0) {
    // Replace all occurrences (case-insensitive — email comparison normalize).
    const escaped = emailPlain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    sanitized = sanitized.replace(new RegExp(escaped, "gi"), "<recipient>")
  }
  // Generic catch-all : remplace tout pattern email-like par <recipient>.
  sanitized = sanitized.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    "<recipient>",
  )
  return sanitized.slice(0, 500)
}

/**
 * L3 round 2 review — language whitelist + typed.
 */
const ALLOWED_LANGUAGES = ["fr", "en", "ar"] as const
type AllowedLanguage = typeof ALLOWED_LANGUAGES[number]
function normalizeLanguage(raw: string | null | undefined): AllowedLanguage {
  if (raw && (ALLOWED_LANGUAGES as readonly string[]).includes(raw)) {
    return raw as AllowedLanguage
  }
  return "fr"
}

/**
 * H3 round 2 — p-limit pure JS (pas de dep externe).
 * Limite N promesses en parallèle.
 */
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

export const invoiceReminderService = {
  /**
   * Cron entrypoint — traite TOUS les step en sequence.
   *
   * Round 2 architecture :
   *   - H5 : advisory lock global anti double-run concurrents.
   *   - M9 : orderBy issuedAt asc (priorise oldest).
   *   - H1 : filter patient.deletedAt + user.status='active' (RGPD Art. 17).
   *   - H3 : p-limit 10 concurrence + timeout 50s break.
   */
  async processOverdueInvoices(
    now: Date,
    ctx: AuditContext,
  ): Promise<ReminderRunMetrics> {
    const metrics = emptyMetrics()
    const t0 = Date.now()

    // H5 round 2 — advisory lock global cron (PG transaction-scoped lock).
    // Si un autre run cron est en cours (OVH + Vercel oublies actifs),
    // on skip ce run pour eviter double-envoi Resend cote patient.
    return prisma.$transaction(async (tx) => {
      // hashtextextended : 64-bit hash stable, parfait pour advisory lock key.
      const lockResult = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(
          hashtextextended('invoice-reminder-cron', 0)
        ) AS locked
      `
      const locked = lockResult[0]?.locked === true
      if (!locked) {
        metrics.skippedConcurrent = true
        // Audit anti-double-run pour SOC visibility.
        await auditService.logWithTx(tx, {
          userId: CRON_AUDIT_USER_ID,
          action: "CREATE",
          resource: "INVOICE_REMINDER",
          resourceId: "cron",
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: { kind: AUDIT_KIND.CRON_SKIPPED_LOCKED },
        }).catch((err) => {
          // M7 round 2 — log structured (pas silent .catch).
          logger.error(
            "invoice-reminder",
            "audit cron.skipped_locked failed",
            { kind: "audit.write.failed" },
            err,
          )
        })
        return metrics
      }

      const limit = pLimit<ResultKind>(PARALLEL_CONCURRENCY)

      for (const { step, delayDays } of REMINDER_STEPS) {
        if (Date.now() - t0 > CRON_TIMEOUT_MS) {
          metrics.timedOut = true
          break
        }
        const cutoff = new Date(now.getTime() - delayDays * 24 * 3600_000)
        // H1 round 2 — filter patient.deletedAt + user.status='active'.
        // M9 round 2 — orderBy issuedAt asc (oldest first).
        const overdueInvoices = await tx.invoice.findMany({
          where: {
            status: "issued",
            issuedAt: { lte: cutoff },
            reminders: { none: { step } },
            patient: {
              deletedAt: null,
              user: { status: "active" },
            },
          },
          select: {
            id: true,
            number: true,
            totalCents: true,
            currency: true,
            issuedAt: true,
            patientId: true,
            patient: {
              select: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    language: true,
                  },
                },
              },
            },
          },
          orderBy: { issuedAt: "asc" },
          take: MAX_INVOICES_PER_STEP,
        })

        // H3 round 2 — parallel send via p-limit, break si timeout.
        const tasks: Array<Promise<ResultKind>> = []
        for (const inv of overdueInvoices) {
          if (Date.now() - t0 > CRON_TIMEOUT_MS) {
            metrics.timedOut = true
            break
          }
          tasks.push(
            limit(() => this.sendReminderForInvoice(inv, step, ctx)),
          )
        }
        const results = await Promise.allSettled(tasks)
        for (const r of results) {
          if (r.status === "fulfilled") {
            metrics.processed += 1
            metrics[r.value] += 1
            metrics.byStep[step][r.value] += 1
          } else {
            // Throw inattendu (pas Resend fail qui est catche dans send).
            // Catch fallback metric `failed`.
            metrics.processed += 1
            metrics.failed += 1
            metrics.byStep[step].failed += 1
            logger.error(
              "invoice-reminder",
              "task unexpected throw",
              { resource: "INVOICE_REMINDER" },
              r.reason,
            )
          }
        }
        if (metrics.timedOut) break
      }

      // Audit cron run final.
      const auditKind = metrics.timedOut ? AUDIT_KIND.CRON_TIMEOUT : AUDIT_KIND.CRON_RUN
      await auditService.logWithTx(tx, {
        userId: CRON_AUDIT_USER_ID,
        action: "CREATE",
        resource: "INVOICE_REMINDER",
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
          "invoice-reminder",
          "audit cron.run failed",
          { kind: "audit.write.failed" },
          err,
        )
      })

      return metrics
    })
  },

  /**
   * Envoi single reminder + persist InvoiceReminder + audit.
   *
   * Round 2 architecture :
   *   - H4 : sanitize Resend error (PII leak).
   *   - H8 : metadata.patientId propage (US-2268).
   *   - M3 : recheck status='issued' dans la tx persistReminder.
   *
   * @internal
   */
  async sendReminderForInvoice(
    inv: {
      id: number
      number: string | null
      totalCents: number
      currency: string
      issuedAt: Date | null
      patientId: number | null
      patient: { user: { id: number; email: string; language: string | null } } | null
    },
    step: InvoiceReminderStep,
    ctx: AuditContext,
  ): Promise<ResultKind> {
    if (!inv.patient || !inv.number || !inv.issuedAt) {
      await this.persistReminder(
        inv.id, step, "skipped", null, null, "no_recipient",
        inv.patientId, ctx,
      )
      return "skipped"
    }

    const emailPlain = safeDecryptField(inv.patient.user.email)
    if (!emailPlain) {
      await this.persistReminder(
        inv.id, step, "skipped", null, null, "email_decrypt_failed",
        inv.patientId, ctx,
      )
      logger.warn(
        "invoice-reminder",
        "email decrypt failed",
        { userId: inv.patient.user.id, kind: "invoice.reminder.skipped" },
      )
      return "skipped"
    }

    const language = normalizeLanguage(inv.patient.user.language)
    const totalFormatted = formatAmount(inv.totalCents, inv.currency, language)
    const stepCfg = REMINDER_STEPS.find((s) => s.step === step)!
    const dueDate = new Date(inv.issuedAt.getTime() + stepCfg.delayDays * 24 * 3600_000)
    const dueDateFormatted = formatDate(dueDate, language)

    let emailResult
    try {
      emailResult = await emailService.sendInvoiceReminder({
        email: emailPlain,
        invoiceNumber: inv.number,
        totalAmount: totalFormatted,
        dueDate: dueDateFormatted,
        step,
        invoiceId: inv.id,
        language,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown"
      // H4 round 2 — sanitize plaintext email avant persist.
      const sanitized = sanitizeResendError(msg, emailPlain)
      await this.persistReminder(
        inv.id, step, "failed", emailPlain, null, sanitized,
        inv.patientId, ctx,
      )
      logger.error("invoice-reminder", "send threw", { resource: "INVOICE_REMINDER" }, err)
      return "failed"
    }

    if (!emailResult.sent) {
      const sanitized = sanitizeResendError(emailResult.error ?? "unknown", emailPlain)
      await this.persistReminder(
        inv.id, step, "failed", emailPlain, null, sanitized,
        inv.patientId, ctx,
      )
      return "failed"
    }

    await this.persistReminder(
      inv.id, step, "sent", emailPlain, emailResult.id ?? null, null,
      inv.patientId, ctx,
    )
    return "sent"
  },

  /**
   * Persist InvoiceReminder + audit en une transaction.
   *
   * Round 2 :
   *   - H8 : `patientId` propage dans audit metadata (US-2268).
   *   - M3 : recheck `status === issued` avant persist (TOCTOU).
   *   - P2002 catch → silent skip (idempotence cron retry).
   *
   * @internal
   */
  async persistReminder(
    invoiceId: number,
    step: InvoiceReminderStep,
    status: ResultKind,
    emailPlain: string | null,
    emailMessageId: string | null,
    errorMessage: string | null,
    patientId: number | null,
    ctx: AuditContext,
  ): Promise<void> {
    const sentToEnc = emailPlain ? encryptField(emailPlain) : null
    try {
      await prisma.$transaction(async (tx) => {
        // M3 round 2 — recheck status='issued' (TOCTOU paid/cancelled).
        // Si l'invoice a transitionne entre le findMany et maintenant,
        // on ne persiste pas (l'email est deja parti — c'est un side
        // effect accepte du M4 race fenetre etroite, mais le row reflete
        // l'etat actuel).
        const fresh = await tx.invoice.findUnique({
          where: { id: invoiceId },
          select: { status: true },
        })
        if (fresh?.status !== "issued") {
          // Invoice transitioned entre findMany et persist → log audit
          // skipped pour traçabilité forensique sans persister un row
          // potentiellement faux.
          logger.warn(
            "invoice-reminder",
            "status changed during run",
            { resource: "INVOICE_REMINDER" },
          )
          return
        }
        await tx.invoiceReminder.create({
          data: {
            invoiceId, step, status, sentToEnc, emailMessageId, errorMessage,
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
          resource: "INVOICE_REMINDER",
          resourceId: String(invoiceId),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: {
            kind: auditKind,
            step,
            // H8 round 2 — patientId pivot US-2268 (ADR #18).
            ...(patientId && { patientId }),
            ...(emailMessageId && { emailMessageId }),
            ...(errorMessage && { errorReason: errorMessage }),
          },
        })
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError
        && e.code === "P2002"
      ) {
        // L2 round 2 review — log debug pour debug "pourquoi mon reminder
        // n'apparait pas". Pas error/warn pour eviter spam.
        logger.debug?.(
          "invoice-reminder",
          "idempotent skip",
          { resource: "INVOICE_REMINDER", kind: "duplicate" },
        )
        return
      }
      throw e
    }
  },
}
