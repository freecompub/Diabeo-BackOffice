/**
 * Groupe 10 Batch C — Travel mode auto-protocol helper (US-2235).
 * GET — compute a default basal multiplier + delay from a `tzOffset` query
 *       param. Stateless helper, no patient FK, no DB write. NURSE+ only
 *       (UI pre-fill aid ; final values still need DOCTOR validation).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { computeBasalProtocol } from "@/lib/services/patient-modes.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const querySchema = z.object({
  tzOffsetHours: z.coerce.number().min(-12).max(14),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    // L4 (re-review C, post-merge) — ADR #18 (US-2268) : resourceId must
    //   be a native ID (or "0" when stateless). String literals like
    //   "auto-protocol" break `auditService.getByPatient` forensic queries.
    //   This endpoint has no patient FK and no PHI access ; 403 audit
    //   metadata.requiredRole already disambiguates from other PATIENT_MODE
    //   accessDenied rows.
    await auditedRequireRole(req, "NURSE", ctx, "PATIENT_MODE", "0")
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const out = computeBasalProtocol(parsed.data.tzOffsetHours)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patient/modes/travel/auto-protocol GET", ctx.requestId)
  }
}
