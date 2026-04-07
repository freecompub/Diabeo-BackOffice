import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { diabetesEventSchema } from "@/lib/validators/events"
import { eventsService } from "@/lib/services/events.service"
import { extractRequestContext } from "@/lib/services/audit.service"

/** POST /api/events — create a diabetes event */
export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const pidParam = req instanceof Request ? new URL(req.url).searchParams.get("patientId") : null
    const patientId = await resolvePatientId(user.id, user.role, pidParam ? parseInt(pidParam, 10) : undefined)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const body = await req.json()
    const parsed = diabetesEventSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    const event = await eventsService.create(patientId, parsed.data, user.id, ctx)
    return NextResponse.json(event, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[events POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
