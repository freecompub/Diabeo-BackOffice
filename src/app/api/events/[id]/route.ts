import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { eventsService } from "@/lib/services/events.service"
import { extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

/** Separate update schema — does NOT use .partial() to preserve superRefine */
const updateEventSchema = z.object({
  eventDate: z.string().datetime().optional(),
  glycemiaValue: z.number().min(20).max(600).optional(),
  carbohydrates: z.number().min(0).optional(),
  bolusDose: z.number().min(0).max(25).optional(),
  basalDose: z.number().min(0).max(10).optional(),
  activityDuration: z.number().int().positive().max(600).optional(),
  weight: z.number().positive().max(300).optional(),
  hba1c: z.number().min(4.0).max(14.0).optional(),
  ketones: z.number().min(0).max(20).optional(),
  systolicPressure: z.number().int().min(50).max(300).optional(),
  diastolicPressure: z.number().int().min(20).max(200).optional(),
  comment: z.string().max(1000).optional(),
})

/** PUT /api/events/:id — update a diabetes event */
export async function PUT(req: NextRequest, { params }: RouteParams) {
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

    const { id } = await params
    const body = await req.json()
    const parsed = updateEventSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    const event = await eventsService.update(id, patientId, parsed.data, user.id, ctx)
    return NextResponse.json(event)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error && error.message === "eventNotFound") {
      return NextResponse.json({ error: "eventNotFound" }, { status: 404 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[events/:id PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/** DELETE /api/events/:id — delete a diabetes event */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
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

    const { id } = await params
    const ctx = extractRequestContext(req)
    await eventsService.delete(id, patientId, user.id, ctx)
    return NextResponse.json({ deleted: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error && error.message === "eventNotFound") {
      return NextResponse.json({ error: "eventNotFound" }, { status: 404 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[events/:id DELETE]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
