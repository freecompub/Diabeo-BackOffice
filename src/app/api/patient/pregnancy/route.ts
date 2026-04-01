import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { auditService } from "@/lib/services/audit.service"

const createPregnancySchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gestationalAge: z.number().int().min(0).max(45).optional(),
  notes: z.string().max(1000).optional(),
})

/** GET /api/patient/pregnancy — active pregnancy or null */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const patientId = await getOwnPatientId(user.id)

    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const pregnancy = await prisma.patientPregnancy.findFirst({
      where: { patientId, active: true },
    })

    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "PATIENT",
      resourceId: `${patientId}:pregnancy`,
    })

    return NextResponse.json(pregnancy)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/pregnancy GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/** POST /api/patient/pregnancy — declare new pregnancy */
export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const patientId = await getOwnPatientId(user.id)

    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const body = await req.json()
    const parsed = createPregnancySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    return prisma.$transaction(async (tx) => {
      // Deactivate any existing active pregnancy
      await tx.patientPregnancy.updateMany({
        where: { patientId, active: true },
        data: { active: false },
      })

      const pregnancy = await tx.patientPregnancy.create({
        data: {
          patientId,
          active: true,
          dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
          gestationalAge: parsed.data.gestationalAge,
          notes: parsed.data.notes,
        },
      })

      await auditService.logWithTx(tx, {
        userId: user.id,
        action: "CREATE",
        resource: "PATIENT",
        resourceId: `${patientId}:pregnancy:${pregnancy.id}`,
      })

      return NextResponse.json(pregnancy, { status: 201 })
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/pregnancy POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
