import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService } from "@/lib/services/audit.service"

const createPregnancySchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gestationalAge: z.number().int().min(0).max(43).optional(),
  notes: z.string().min(1).max(1000).optional(),
})

/** GET /api/patient/pregnancy — active pregnancy or null */
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

    const pregnancy = await prisma.patientPregnancy.findFirst({
      where: { patientId, active: true },
    })

    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "PATIENT",
      resourceId: `${patientId}:pregnancy`,
    })

    if (!pregnancy) return NextResponse.json(null)

    return NextResponse.json({
      ...pregnancy,
      notes: safeDecryptField(pregnancy.notes),
    })
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

    const body = await req.json()
    const parsed = createPregnancySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const pregnancy = await prisma.$transaction(async (tx) => {
      await tx.patientPregnancy.updateMany({
        where: { patientId, active: true },
        data: { active: false },
      })

      const created = await tx.patientPregnancy.create({
        data: {
          patientId,
          active: true,
          dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
          gestationalAge: parsed.data.gestationalAge,
          notes: parsed.data.notes ? encryptField(parsed.data.notes) : null,
        },
      })

      await auditService.logWithTx(tx, {
        userId: user.id,
        action: "CREATE",
        resource: "PATIENT",
        resourceId: `${patientId}:pregnancy:${created.id}`,
      })

      return created
    })

    return NextResponse.json({
      ...pregnancy,
      notes: safeDecryptField(pregnancy.notes),
    }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/pregnancy POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
