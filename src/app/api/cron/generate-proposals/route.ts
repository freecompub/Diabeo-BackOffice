/**
 * @route POST /api/cron/generate-proposals
 * @description US-2651 — Cron entry du générateur de propositions d'ajustement (ICR + basal + ISF +
 *   fixedDose + flags mode c).
 *
 * **Authentification** : Bearer `CRON_SECRET` (env var), pas de JWT user — cron externe
 * (OVHcloud cron / Vercel cron / GitHub Action). `CRON_SECRET` validé par `assertRequiredEnv()`
 * au boot. **POST uniquement** (US-2652 activation prod, aligné sur les crons rappels round 2 H3) :
 * GET ferait fuiter le `Bearer` dans les access logs Nginx / le header `Referer` CDN / le cache →
 * `GET` non exporté → Next.js répond **405**. Le scheduler DOIT utiliser `curl -X POST`.
 *
 * **Idempotent + anti double-run** : `generateForAllPatients` prend un verrou advisory session
 * (`withSessionAdvisoryLock`) ; deux runs concurrents (OVH + Vercel) → l'un skip (`skippedConcurrent`).
 * Chaque proposition est de toute façon dédupliquée par l'index `one_pending_per_slot`.
 *
 * **Auth failure audit** : un Bearer manquant/faux émet un audit `cron.auth.failed` (burst detection SOC).
 *
 * **Retour** : métriques JSON `{ processed, created, flagged, errored, skippedConcurrent }` (aucune PHI).
 *
 * **Cron schedule recommandé** : `0 2 * * *` (2 h locale — analyse nocturne, hors pics d'usage).
 * **Runbook** : `docs/runbook/cron-proposal-generator.md` (⚠️ bloqueur pré-prod : signature DPO).
 */
import { NextResponse, type NextRequest } from "next/server"
import { timingSafeEqual } from "crypto"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { proposalGeneratorService } from "@/lib/services/proposal-generator.service"
import { logger } from "@/lib/logger"

/** Comparaison à temps constant (longueur du `CRON_SECRET` publique par convention). */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

async function emitAuthFailedAudit(_req: NextRequest, ctx: ReturnType<typeof extractRequestContext>): Promise<void> {
  // Audit auth failed (burst detection SOC). Caller anonyme (bypass JWT) → userId null (système).
  await auditService.log({
    userId: null,
    action: "UNAUTHORIZED",
    resource: "ADJUSTMENT_PROPOSAL",
    resourceId: "cron",
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    metadata: { kind: "cron.auth.failed" },
  }).catch((err) => {
    logger.error("cron-generate-proposals", "audit auth.failed write failed", { kind: "audit.write.failed" }, err)
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
      // Sans secret configuré, la route est neutralisée (defense-in-depth ; le boot aurait dû crash).
      logger.error("cron-generate-proposals", "CRON_SECRET not configured — route disabled", { statusCode: 503 })
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
    const metrics = await proposalGeneratorService.generateForAllPatients(ctx)
    const durationMs = Date.now() - t0

    logger.info("cron-generate-proposals", "run completed", { resource: "ADJUSTMENT_PROPOSAL", durationMs })
    return jsonResponse(metrics)
  } catch (e) {
    return mapErrorToResponse(e, "cron/generate-proposals", ctx.requestId)
  }
}

// Action mutante (génère des propositions) = POST uniquement (RFC 7231 §4.3.3). `GET` non exporté →
// Next.js répond 405 → évite le leak de `CRON_SECRET` via access logs / Referer / cache CDN.
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}
