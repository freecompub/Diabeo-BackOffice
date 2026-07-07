import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { logger } from "@/lib/logger"
import { proposalGeneratorService, ISF_ANALYSIS_WINDOW_DAYS } from "@/lib/services/proposal-generator.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })
const bodySchema = z.object({ windowDays: z.number().int().min(2).max(14) })

/**
 * POST — **génération de propositions à la demande** (US-2658). Réservé **DOCTOR/NURSE** (min NURSE ;
 * patient/VIEWER → 403). Fenêtre d'analyse bornée **[2,14] jours** — hors bornes → 400 `windowOutOfBounds`.
 *
 * Réutilise le générateur existant (`generateForPatient`) avec la fenêtre en paramètre : **propose,
 * n'applique jamais** (`pending`, gaté médecin, ADR #13) ; tous les garde-fous s'appliquent (garde hypo,
 * bornes cliniques, seuils de suffisance, anti-empilement `one_pending_per_slot`). « Rien à proposer »
 * (données minces / bon contrôle) est un **succès** (`created: 0`, `reason`), pas une erreur.
 *
 * Scopé patient (anti-IDOR via `resolvePatientId` → 404 si hors périmètre). Audité (acteur soignant
 * réel — ≠ acteur système `null` du cron — fenêtre, résultat, sans PHI).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireRole(req, "NURSE")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    // Rate-limit (ANSSI, anti-abus) : chaque run relance un pipeline analytique non trivial. Fail-open
    // (dispo d'abord) ; la confidentialité repose sur le RBAC/anti-IDOR, pas le limiter. Saturation auditée.
    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.analytics)
    if (!rl.allowed) {
      await auditService
        .rateLimited({
          userId: user.id, resource: "ADJUSTMENT_PROPOSAL", resourceId: "generate",
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
          metadata: { surface: "api", kind: "proposalGenerateOnDemand" },
        })
        .catch((err) => logger.error("audit", "[proposals/generate] rateLimited audit failed", {}, err))
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      )
    }

    const parsedParams = paramsSchema.safeParse(await params)
    if (!parsedParams.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsedBody.success) return NextResponse.json({ error: "windowOutOfBounds" }, { status: 400 })
    const windowDays = parsedBody.data.windowDays

    // Anti-IDOR : le patient ciblé doit être dans le périmètre du soignant (sinon 404, anti-énumération).
    const patientId = await resolvePatientId(user.id, user.role, parsedParams.data.id)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const result = await proposalGeneratorService.generateForPatient(patientId, user.id, ctx, windowDays)

    // Audit best-effort (comme les autres audits du service) : un échec d'audit ne doit PAS renvoyer
    // 500 sur un run qui a déjà persisté ses propositions.
    await auditService
      .log({
        userId: user.id,
        action: "CREATE",
        resource: "ADJUSTMENT_PROPOSAL",
        resourceId: String(patientId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          kind: "proposal.generator.on_demand",
          patientId,
          windowDays,
          created: result.created,
          flagged: result.flagged,
          skipped: result.skipped,
        },
      })
      .catch((err) => logger.error("audit", "[proposals/generate] audit failed", {}, err))

    return NextResponse.json({
      created: result.created,
      flagged: result.flagged,
      windowDays,
      // L'ISF n'utilise PAS `windowDays` : il titre toujours sur 30 j (décision §3). Exposé pour que
      // l'UI de déclenchement précise « l'analyse des corrections reste sur 30 jours ».
      isfWindowDays: ISF_ANALYSIS_WINDOW_DAYS,
      // Rien produit → motif explicite (données insuffisantes / bon contrôle / mode). Succès, pas erreur.
      reason: result.created === 0 && result.flagged === 0 ? (result.skipped ?? "nothingToPropose") : null,
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[proposals/generate POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
