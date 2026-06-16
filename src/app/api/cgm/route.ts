import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { CGM_RECENT_OOR_HEADER, recentOutOfRangeFrom } from "@/lib/cgm-freshness"

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((d) => d.from < d.to, { message: "from must be before to" })

/** GET /api/cgm?from=&to= — raw CGM entries */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    }
    const patientId = res.patientId

    const params = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(params)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    const entries = await glycemiaService.getCgmEntries(
      patientId, parsed.data.from, parsed.data.to, user.id, ctx,
    )

    // Signal de fraîcheur (sécurité clinique) en HEADER additif — body inchangé
    // (tableau plat) pour ne pas casser iOS ni les consommateurs in-repo.
    // Fail-soft sur le signal secondaire.
    const latestRaw = await glycemiaService
      .getLatestCgmFreshness(patientId, parsed.data.from, parsed.data.to, user.id, ctx)
      .catch(() => null)
    const recentOutOfRange = recentOutOfRangeFrom(entries.at(-1)?.timestamp ?? null, latestRaw)

    return NextResponse.json(entries, {
      headers: { [CGM_RECENT_OOR_HEADER]: recentOutOfRange ?? "none" },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[cgm GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
