/**
 * @route POST /api/cron/appointments/reminders
 * @description US-2502 — Cron quotidien rappels RDV multi-canal.
 *
 * Bearer `CRON_SECRET` timing-safe + headers ANSSI + audit auth fail.
 * Réutilise pattern PR #417 (US-2108 invoice reminders).
 *
 * **POST uniquement** depuis round 2 H3 fix : GET retiré pour éviter leak
 * de `CRON_SECRET` via Nginx access logs / Referer header / cache CDN.
 * Le scheduler OVH/Vercel doit utiliser `curl -X POST` — voir runbook
 * `docs/runbook/cron-reminders.md`.
 *
 * **Schedule recommandé** : `0 9 * * *` (9h Paris) — meilleur taux
 * d'ouverture côté patient.
 */
import { NextResponse, type NextRequest } from "next/server"
import { timingSafeEqual } from "crypto"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { appointmentReminderService } from "@/lib/services/appointment-reminder.service"
import { logger } from "@/lib/logger"

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

async function emitAuthFailedAudit(
  _req: NextRequest,
  ctx: ReturnType<typeof extractRequestContext>,
): Promise<void> {
  await auditService.log({
    userId: null,
    action: "UNAUTHORIZED",
    resource: "APPOINTMENT_REMINDER",
    resourceId: "cron",
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    metadata: { kind: "cron.auth.failed" },
  }).catch((err) => {
    logger.error(
      "cron-appointments",
      "audit auth.failed write failed",
      { kind: "audit.write.failed" },
      err,
    )
  })
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: SECURITY_HEADERS })
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const ctx = extractRequestContext(req)
  try {
    const expectedSecret = process.env.CRON_SECRET
    if (!expectedSecret) {
      logger.error(
        "cron-appointments",
        "CRON_SECRET not configured — route disabled",
        { statusCode: 503 },
      )
      return jsonResponse({ error: "cronDisabled" }, 503)
    }

    const auth = req.headers.get("authorization") ?? ""
    const match = auth.match(/^Bearer\s+(\S+)\s*$/)
    const submittedSecret = match?.[1] ?? ""
    if (!submittedSecret || !constantTimeEqual(submittedSecret, expectedSecret)) {
      await emitAuthFailedAudit(req, ctx)
      return jsonResponse({ error: "unauthorized" }, 401)
    }

    const t0 = Date.now()
    const metrics = await appointmentReminderService.processAppointmentReminders(
      new Date(), ctx,
    )
    const durationMs = Date.now() - t0

    logger.info(
      "cron-appointments",
      "run completed",
      { resource: "APPOINTMENT_REMINDER", durationMs },
    )

    return jsonResponse(metrics)
  } catch (e) {
    return mapErrorToResponse(e, "cron/appointments/reminders", ctx.requestId)
  }
}

// H3 round 2 review — `GET` retiré. Action mutante = POST uniquement
// (RFC 7231 §4.3.3). Évite leak de `CRON_SECRET` via Nginx access logs /
// Referer / cache CDN (Cache-Control: no-store mal honoré par certains
// proxies pour GET). Si le scheduler OVH/Vercel envoie GET → 405 ; à
// adapter à `curl -X POST` dans le runbook.
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}
