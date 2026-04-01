import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { Pathology } from "@prisma/client"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientService } from "@/lib/services/patient.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

const updateSchema = z.object({
  pathology: z.nativeEnum(Pathology).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

/** GET /api/patients/:id — healthcare pro access to patient */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id } = await params

    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    }
    const patientId = parseInt(id, 10)

    // Access control: only patients from the pro's service
    const ctx = extractRequestContext(req)
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.log({
        userId: user.id,
        action: "UNAUTHORIZED",
        resource: "PATIENT",
        resourceId: String(patientId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const patient = await patientService.getById(patientId, user.id, ctx)

    if (!patient) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    return NextResponse.json(patient)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/** PUT /api/patients/:id — healthcare pro update patient (DOCTOR+ only) */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const { id } = await params

    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    }
    const patientId = parseInt(id, 10)

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const body = await req.json()
    const parsed = updateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await patientService.updateProfile(patientId, parsed.data, user.id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
