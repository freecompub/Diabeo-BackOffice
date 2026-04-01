import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { auditService } from "@/lib/services/audit.service"

const updatePregnancySchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gestationalAge: z.number().int().min(0).max(45).optional(),
  notes: z.string().max(1000).optional(),
  active: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

/** PUT /api/patient/pregnancy/:id — update pregnancy */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireAuth(req)
    const patientId = await getOwnPatientId(user.id)

    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const { id } = await params
    const pregnancyId = parseInt(id, 10)

    if (!Number.isInteger(pregnancyId) || pregnancyId <= 0) {
      return NextResponse.json({ error: "invalidPregnancyId" }, { status: 400 })
    }

    const body = await req.json()
    const parsed = updatePregnancySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Verify pregnancy belongs to this patient
    const existing = await prisma.patientPregnancy.findFirst({
      where: { id: pregnancyId, patientId },
    })

    if (!existing) {
      return NextResponse.json({ error: "pregnancyNotFound" }, { status: 404 })
    }

    return prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = { ...parsed.data }
      if (parsed.data.dueDate) {
        data.dueDate = new Date(parsed.data.dueDate)
      }

      const pregnancy = await tx.patientPregnancy.update({
        where: { id: pregnancyId },
        data,
      })

      await auditService.logWithTx(tx, {
        userId: user.id,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:pregnancy:${pregnancyId}`,
        metadata: { updatedFields: Object.keys(parsed.data) },
      })

      return NextResponse.json(pregnancy)
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/pregnancy/:id PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
