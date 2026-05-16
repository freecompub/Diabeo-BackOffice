/**
 * @route POST /api/cron/billing/reminders
 * @description US-2108 — Cron entry pour relances factures automatiques.
 *
 * **Authentification** : Bearer `CRON_SECRET` (env var). Pas de JWT user
 * — c'est un cron external (OVHcloud cron / Vercel cron / GitHub Action).
 * Refuse si `CRON_SECRET` non-set en prod (defense-in-depth).
 *
 * **Idempotent** : `processOverdueInvoices` est safe a rejouer (UNIQUE
 * constraint sur InvoiceReminder). OK de scheduler 1×/24h ou plus
 * frequent (pas d'effet de bord si rejoue dans la meme journee).
 *
 * **Retour** : metrics JSON `{ processed, sent, failed, skipped, byStep }`
 * pour observabilite cron (Grafana/Sentry alert si failed > seuil).
 *
 * **Cron schedule recommande** : `0 9 * * *` (9h locale Paris, quand
 * les patients sont eveilles → meilleur taux d'ouverture).
 */
import { NextResponse, type NextRequest } from "next/server"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { invoiceReminderService } from "@/lib/services/invoice-reminder.service"
import { logger } from "@/lib/logger"
import { timingSafeEqual } from "crypto"

/**
 * Comparaison constant-time pour eviter timing-attack sur CRON_SECRET.
 * Strings doivent etre meme longueur — on pad si necessaire (sans leak
 * de longueur via early return).
 */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) {
    // Compare quand meme avec un buffer pad pour ne pas leak length difference.
    timingSafeEqual(bufA, Buffer.alloc(bufA.length))
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const expectedSecret = process.env.CRON_SECRET
    if (!expectedSecret) {
      // Defense-in-depth : sans secret configure, la route est neutralisee.
      // Empeche un cron-malveillant d'envoyer 500 emails si on oublie
      // la config env-var en prod.
      logger.error(
        "cron-reminders",
        "CRON_SECRET not configured — route disabled",
        { statusCode: 503 },
      )
      return NextResponse.json({ error: "cronDisabled" }, { status: 503 })
    }

    const auth = req.headers.get("authorization") ?? ""
    const match = auth.match(/^Bearer\s+(.+)$/)
    if (!match || !constantTimeEqual(match[1]!, expectedSecret)) {
      // Aucune divulgation de raison (timing-safe).
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }

    const metrics = await invoiceReminderService.processOverdueInvoices(
      new Date(), ctx,
    )

    logger.info(
      "cron-reminders",
      "run completed",
      {
        resource: "INVOICE_REMINDER",
        durationMs: 0, // (peut etre rempli par middleware obs futur)
      },
    )

    return NextResponse.json(metrics, {
      headers: { "Cache-Control": "no-store, private" },
    })
  } catch (e) {
    return mapErrorToResponse(e, "cron/billing/reminders POST", ctx.requestId)
  }
}
