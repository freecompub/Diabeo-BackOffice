/**
 * US-2603 — Switcher de contexte patient : récemment vus + épinglés du PS.
 *
 * `GET /api/patients/recent` → `{ recent: PatientRef[], pinned: PatientRef[] }`.
 *
 * Sécurité : RBAC NURSE+, scope dur appliqué côté service (intersection
 * `getAccessiblePatientIds`), rate-limit `patientDataRead` (la réponse contient
 * des noms PII déchiffrés), headers `no-store` (RGPD Art. 32), accès audité.
 */

import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { recentPatientsService } from "@/lib/services/recent-patients.service"
import { extractRequestContext } from "@/lib/services/audit.service"

/** Headers anti-cache sur une réponse contenant des PII (cf. /patients/search). */
function setNoStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
  res.headers.set("Pragma", "no-cache")
  res.headers.set("Referrer-Policy", "no-referrer")
  res.headers.set("X-Content-Type-Options", "nosniff")
  return res
}

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const ctx = extractRequestContext(req)

    // Double bucket per-user + per-IP (réponse = noms PII déchiffrés), aligné sur
    // /patients/search. Fail-open — la confidentialité repose sur le scope RBAC.
    const rlUser = await checkApiRateLimit(String(user.id), RATE_LIMITS.patientDataRead)
    if (!rlUser.allowed) {
      return setNoStore(
        NextResponse.json(
          { error: "rateLimitExceeded" },
          { status: 429, headers: { "Retry-After": String(rlUser.retryAfterSec) } },
        ),
      )
    }
    // Per-IP : SKIP quand l'IP n'est pas résolue ("unknown") pour éviter un
    // bucket partagé `ip:unknown` (DoS auto-infligé). XFF spoofable — durcissement
    // transverse suivi dans docs/security/xff-trusted-proxy.md.
    if (ctx.ipAddress && ctx.ipAddress !== "unknown") {
      const rlIp = await checkApiRateLimit(`ip:${ctx.ipAddress}`, RATE_LIMITS.patientDataReadIp)
      if (!rlIp.allowed) {
        return setNoStore(
          NextResponse.json(
            { error: "rateLimitExceeded" },
            { status: 429, headers: { "Retry-After": String(rlIp.retryAfterSec) } },
          ),
        )
      }
    }

    const result = await recentPatientsService.listRecentAndPinned(
      user.id, user.role, user.id, ctx,
    )
    return setNoStore(NextResponse.json(result))
  } catch (error) {
    if (error instanceof AuthError) {
      return setNoStore(NextResponse.json({ error: error.message }, { status: error.status }))
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/recent GET]", msg)
    return setNoStore(NextResponse.json({ error: "serverError" }, { status: 500 }))
  }
}
