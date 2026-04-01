import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { diabetesEventSchema } from "@/lib/validators/events"
import { eventsService } from "@/lib/services/events.service"

type RouteParams = { params: Promise<{ id: string }> }

/** PUT /api/events/:id — update a diabetes event */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireAuth(req)
    const patientId = await getOwnPatientId(user.id)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const { id } = await params
    const body = await req.json()
    const parsed = diabetesEventSchema.partial().safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const event = await eventsService.update(id, patientId, parsed.data, user.id)
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
    const patientId = await getOwnPatientId(user.id)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const { id } = await params
    await eventsService.delete(id, patientId, user.id)
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
