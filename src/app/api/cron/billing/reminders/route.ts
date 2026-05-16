/**
 * @route GET|POST /api/cron/billing/reminders
 * @description US-2108 — Cron entry pour relances factures automatiques.
 *
 * **Authentification** : Bearer `CRON_SECRET` (env var). Pas de JWT user
 * — c'est un cron external (OVHcloud cron / Vercel cron / GitHub Action).
 * `CRON_SECRET` valide par `assertRequiredEnv()` au boot (H10 round 2).
 *
 * **GET et POST acceptes** (H2 round 2 review) — Vercel cron + OVH cron
 * basic utilisent souvent GET. Refuser GET silencieusement (405) ferait
 * casser le cron en prod sans alerte. Les deux methodes sont semantiquement
 * equivalentes ici (action mutante mais lecture/ecriture audit).
 *
 * **Auth failure audit** (H9 round 2) — Bearer wrong/missing emit audit
 * `cron.auth.failed` accessDenied US-2265 burst detection. Permet SOC de
 * detecter brute-force scan.
 *
 * **Idempotent** : `processOverdueInvoices` est safe a rejouer (UNIQUE
 * + advisory lock H5).
 *
 * **Retour** : metrics JSON `{ processed, sent, failed, skipped, byStep,
 * timedOut, skippedConcurrent }` pour observabilite cron.
 *
 * **Cron schedule recommande** : `0 9 * * *` (9h locale Paris).
 */
import { NextResponse, type NextRequest } from "next/server"
import { timingSafeEqual } from "crypto"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { invoiceReminderService } from "@/lib/services/invoice-reminder.service"
import { logger } from "@/lib/logger"

/**
 * M1 round 2 review — simplifie : la longueur du `CRON_SECRET` est
 * publique par convention (64 hex chars). Pas besoin de timing-protection
 * sur la branche length mismatch. `timingSafeEqual` requiert longueurs
 * egales — early return false sinon.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

async function emitAuthFailedAudit(_req: NextRequest, ctx: ReturnType<typeof extractRequestContext>): Promise<void> {
  // H9 round 2 — audit auth failed (US-2265 burst detection SOC).
  // Caller anonyme (cron route bypass JWT) → userId = null (sentinel système).
  // On utilise `log` direct (pas `accessDenied` helper qui exige userId non-null
  // by design pour RBAC-fail authentifié — notre cas est différent).
  await auditService.log({
    userId: null,
    action: "UNAUTHORIZED",
    resource: "INVOICE_REMINDER",
    resourceId: "cron",
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    metadata: { kind: "cron.auth.failed" },
  }).catch((err) => {
    logger.error(
      "cron-reminders",
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

function jsonResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...SECURITY_HEADERS, ...(extraHeaders ?? {}) },
  })
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const ctx = extractRequestContext(req)
  try {
    const expectedSecret = process.env.CRON_SECRET
    if (!expectedSecret) {
      // Defense-in-depth : sans secret configure, la route est neutralisee.
      // H10 round 2 — `assertRequiredEnv()` au boot devrait deja avoir
      // crash le serveur si CRON_SECRET manquant en prod. Ce check
      // residuel sert pour les workflows dev/test sans cron.
      logger.error(
        "cron-reminders",
        "CRON_SECRET not configured — route disabled",
        { statusCode: 503 },
      )
      return jsonResponse({ error: "cronDisabled" }, 503)
    }

    const auth = req.headers.get("authorization") ?? ""
    // M2 round 2 review — `\S+` plus robuste que `(.+)$` (trailing whitespace).
    const match = auth.match(/^Bearer\s+(\S+)\s*$/)
    const submittedSecret = match?.[1] ?? ""
    if (!submittedSecret || !constantTimeEqual(submittedSecret, expectedSecret)) {
      // H9 round 2 — audit auth failed (burst detection SOC).
      await emitAuthFailedAudit(req, ctx)
      return jsonResponse({ error: "unauthorized" }, 401)
    }

    // L5 round 2 — mesure durationMs reelle.
    const t0 = Date.now()
    const metrics = await invoiceReminderService.processOverdueInvoices(
      new Date(), ctx,
    )
    const durationMs = Date.now() - t0

    logger.info(
      "cron-reminders",
      "run completed",
      {
        resource: "INVOICE_REMINDER",
        durationMs,
      },
    )

    return jsonResponse(metrics)
  } catch (e) {
    return mapErrorToResponse(e, "cron/billing/reminders", ctx.requestId)
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}

// H2 round 2 — GET accepte aussi (Vercel cron / OVH cron basic utilisent GET).
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}
