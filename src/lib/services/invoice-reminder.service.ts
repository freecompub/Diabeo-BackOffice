/**
 * @module services/invoice-reminder
 * @description US-2108 — Relances factures automatiques (Batch 4 Facturation).
 *
 * Cron J+7 / J+15 / J+30 via Resend (email service US-2074).
 *
 * ### Selection des factures eligibles
 *
 * Pour chaque step `step_7|step_15|step_30` (delais 7/15/30 jours) :
 *   1. SELECT invoices WHERE `status = 'issued'`
 *      AND `issuedAt <= now - delayDays`
 *      AND NOT EXISTS InvoiceReminder(invoiceId, step).
 *   2. Pour chacune : decrypter email patient → Resend send → INSERT
 *      InvoiceReminder (status sent/failed/skipped) + audit `logWithTx`.
 *
 * ### Idempotence absolue
 *
 * `@@unique([invoiceId, step])` empeche envoi double. Si le cron rejoue
 * (timeout, retry, double-trigger), P2002 catch → skip silencieux.
 *
 * ### Hors scope V1
 *
 *   - Notifications cabinet-interne (invoice sans patient) → skipped.
 *   - Calendrier configurable par cabinet (rappels custom) → V2.
 *   - SMS de relance (US-2506 procurement Twilio) → V2.
 *
 * ### Securite
 *
 *   - Email destinataire chiffre AES-256-GCM dans `InvoiceReminder.sentToEnc`
 *     (forensique sans PHI plaintext en BDD).
 *   - Audit `INVOICE_REMINDER` resource + metadata sans donnee sante.
 *   - Resend best-effort : echec n'interrompt pas le cron, marque
 *     `status='failed'` + log SOC.
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

export const MAX_INVOICES_PER_RUN = 500

// ─────────────────────────────────────────────────────────────
// Audit kinds.
// ─────────────────────────────────────────────────────────────

export type ReminderAuditKind =
  | "invoice.reminder.sent"
  | "invoice.reminder.failed"
  | "invoice.reminder.skipped"
  | "invoice.reminder.cron.run"

const AUDIT_KIND = {
  SENT: "invoice.reminder.sent",
  FAILED: "invoice.reminder.failed",
  SKIPPED: "invoice.reminder.skipped",
  CRON_RUN: "invoice.reminder.cron.run",
} as const satisfies Record<string, ReminderAuditKind>

export { AUDIT_KIND as REMINDER_AUDIT_KIND }

// ─────────────────────────────────────────────────────────────
// Result types.
// ─────────────────────────────────────────────────────────────

export interface ReminderRunMetrics {
  processed: number
  sent: number
  failed: number
  skipped: number
  byStep: Record<InvoiceReminderStep, { sent: number; failed: number; skipped: number }>
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Sentinel : cron interne (pas un User authentifie). */
const CRON_AUDIT_USER_ID = 0

function emptyMetrics(): ReminderRunMetrics {
  return {
    processed: 0, sent: 0, failed: 0, skipped: 0,
    byStep: {
      step_7: { sent: 0, failed: 0, skipped: 0 },
      step_15: { sent: 0, failed: 0, skipped: 0 },
      step_30: { sent: 0, failed: 0, skipped: 0 },
    },
  }
}

/**
 * Localise le montant TTC en string formate selon le pays/devise.
 * Format minimal (sans Intl complet) — V1.5 elargir avec US-2115 formatters.
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
    return date.toISOString().split("T")[0] ?? ""
  }
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export const invoiceReminderService = {
  /**
   * Cron entrypoint — traite TOUS les step en sequence.
   * Cap a MAX_INVOICES_PER_RUN par run pour eviter timeout Resend.
   *
   * @param now Date de reference (injectable pour tests).
   * @param ctx Context audit (cron sentinel).
   */
  async processOverdueInvoices(
    now: Date,
    ctx: AuditContext,
  ): Promise<ReminderRunMetrics> {
    const metrics = emptyMetrics()

    for (const { step, delayDays } of REMINDER_STEPS) {
      const cutoff = new Date(now.getTime() - delayDays * 24 * 3600_000)
      // Selection : invoices issued AND date echeance depassee AND pas
      // de reminder a ce step deja existant. Le `reminders` filter
      // `none` exploite la relation Invoice → InvoiceReminder.
      const overdueInvoices = await prisma.invoice.findMany({
        where: {
          status: "issued",
          issuedAt: { lte: cutoff },
          reminders: {
            none: { step },
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
                  email: true,      // chiffre AES-256-GCM base64
                  language: true,
                },
              },
            },
          },
        },
        take: MAX_INVOICES_PER_RUN,
      })

      for (const inv of overdueInvoices) {
        metrics.processed += 1
        const result = await this.sendReminderForInvoice(inv, step, ctx)
        metrics[result] += 1
        metrics.byStep[step][result] += 1
      }
    }

    // Audit cron run (compteurs metrics, sans PHI).
    await auditService.log({
      userId: CRON_AUDIT_USER_ID,
      action: "CREATE",
      resource: "INVOICE_REMINDER",
      resourceId: "cron",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: AUDIT_KIND.CRON_RUN,
        processed: metrics.processed,
        sent: metrics.sent,
        failed: metrics.failed,
        skipped: metrics.skipped,
      },
    }).catch(() => undefined) // best-effort

    return metrics
  },

  /**
   * Envoi single reminder + persist InvoiceReminder + audit. Idempotent
   * via UNIQUE(invoiceId, step) → P2002 catch = skip silent (cron rejoue).
   *
   * @returns "sent" | "failed" | "skipped" pour metrics.
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
  ): Promise<"sent" | "failed" | "skipped"> {
    // Garde : facture sans patient = pas d'email destinataire (cabinet-
    // interne V1 → skipped). V1.5 elargira aux managers cabinet.
    if (!inv.patient || !inv.number || !inv.issuedAt) {
      await this.persistReminder(inv.id, step, "skipped", null, null, "no_recipient", ctx)
      return "skipped"
    }

    // Dechiffre l'email patient (au moment du send uniquement — pas en bulk).
    const emailPlain = safeDecryptField(inv.patient.user.email)
    if (!emailPlain) {
      await this.persistReminder(inv.id, step, "skipped", null, null, "email_decrypt_failed", ctx)
      logger.warn(
        "invoice-reminder",
        "email decrypt failed",
        { userId: inv.patient.user.id, kind: "invoice.reminder.skipped" },
      )
      return "skipped"
    }

    const language = (inv.patient.user.language === "en" || inv.patient.user.language === "ar"
      ? inv.patient.user.language
      : "fr") as "fr" | "en" | "ar"

    const totalFormatted = formatAmount(inv.totalCents, inv.currency, language)
    // Echeance = issuedAt + delayDays du step (= maintenant pour le cron J+N).
    // V1.5 : ajouter `Invoice.dueDate` colonne si CGU specifie autre delai.
    const stepCfg = REMINDER_STEPS.find((s) => s.step === step)!
    const dueDate = new Date(inv.issuedAt.getTime() + stepCfg.delayDays * 24 * 3600_000)
    const dueDateFormatted = formatDate(dueDate, language)

    // Envoi Resend best-effort.
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
      // Resend API key manquant ou autre erreur fatale.
      const msg = err instanceof Error ? err.message : "unknown"
      await this.persistReminder(inv.id, step, "failed", emailPlain, null, msg.slice(0, 500), ctx)
      logger.error("invoice-reminder", "send threw", { resource: "INVOICE_REMINDER" }, err)
      return "failed"
    }

    if (!emailResult.sent) {
      await this.persistReminder(
        inv.id, step, "failed", emailPlain, null,
        (emailResult.error ?? "unknown").slice(0, 500), ctx,
      )
      return "failed"
    }

    await this.persistReminder(inv.id, step, "sent", emailPlain, emailResult.id ?? null, null, ctx)
    return "sent"
  },

  /**
   * Persist InvoiceReminder + audit en une transaction.
   * Catch P2002 UNIQUE(invoiceId, step) → silent skip (cron retry safe).
   *
   * @internal
   */
  async persistReminder(
    invoiceId: number,
    step: InvoiceReminderStep,
    status: "sent" | "failed" | "skipped",
    emailPlain: string | null,
    emailMessageId: string | null,
    errorMessage: string | null,
    ctx: AuditContext,
  ): Promise<void> {
    const sentToEnc = emailPlain ? encryptField(emailPlain) : null
    try {
      await prisma.$transaction(async (tx) => {
        await tx.invoiceReminder.create({
          data: {
            invoiceId,
            step,
            status,
            sentToEnc,
            emailMessageId,
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
          resource: "INVOICE_REMINDER",
          resourceId: String(invoiceId),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: {
            kind: auditKind,
            step,
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
        // Idempotence : cron rejoue, InvoiceReminder existe deja → skip.
        return
      }
      throw e
    }
  },
}
