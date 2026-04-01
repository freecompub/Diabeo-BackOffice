import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
})

/** GET /api/cgm?from=&to= — raw CGM entries */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const patientId = await getOwnPatientId(user.id)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

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

    return NextResponse.json(entries)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[cgm GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
