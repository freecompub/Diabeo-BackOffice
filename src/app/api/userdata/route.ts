import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  datefirst: z.coerce.date(),
  datelast: z.coerce.date(),
}).refine((d) => d.datefirst < d.datelast, {
  message: "datefirst must be before datelast",
})

/** GET /api/userdata?datefirst=&datelast= — combined health data */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const pidParam = new URL(req.url).searchParams.get("patientId")
    const patientId = await resolvePatientId(
      user.id,
      user.role,
      pidParam ? parseInt(pidParam, 10) : undefined,
    )
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

    const { datefirst, datelast } = parsed.data
    const ctx = extractRequestContext(req)

    const [cgm, glycemia, averages, insulinflow, pumpevents] = await Promise.all([
      glycemiaService.getCgmEntries(patientId, datefirst, datelast, user.id, ctx),
      glycemiaService.getGlycemiaEntries(patientId, datefirst, datelast, user.id, ctx),
      glycemiaService.getAverageData(patientId, user.id, ctx),
      glycemiaService.getInsulinFlow(patientId, datefirst, datelast, user.id, ctx),
      glycemiaService.getPumpEvents(patientId, datefirst, datelast, user.id, ctx),
    ])

    return NextResponse.json({
      success: true,
      datefirst: datefirst.toISOString(),
      datelast: datelast.toISOString(),
      data: { cgm, glycemia, avgdata: averages.current, avgdata7: averages.avg7d, avgdata30: averages.avg30d, insulinflow, pumpevents },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[userdata GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
