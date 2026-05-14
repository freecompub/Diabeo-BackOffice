/** US-2123 — Manually retry a failed FHIR sync (ADMIN). */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { fhirInteropService } from "@/lib/services/fhir-interop.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "ADMIN", ctx, "FHIR_INTEROP", id)

    // M1 — rate-limit per ADMIN user (5 req/h, fail-closed). Prevents accidental
    //      loops + outbound DoS on the partner FHIR endpoint.
    const rl = await checkApiRateLimit(`user:${user.id}`, RATE_LIMITS.fhirRetryAdmin)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "tooManyRequests", retryAfterSec: rl.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      )
    }

    const out = await fhirInteropService.retry(parseInt(id, 10), user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "interop/fhir/:id/retry POST", ctx.requestId)
  }
}
