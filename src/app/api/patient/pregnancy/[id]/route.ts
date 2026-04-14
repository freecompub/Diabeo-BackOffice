import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService } from "@/lib/services/audit.service"

const updatePregnancySchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gestationalAge: z.number().int().min(0).max(43).optional(),
  notes: z.string().min(1).max(1000).optional(),
  active: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

/** PUT /api/patient/pregnancy/:id — update pregnancy */
export async function PUT(req: NextRequest, { params }: RouteParams) {
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

    const { id } = await params
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "invalidPregnancyId" }, { status: 400 })
    }
    const pregnancyId = parseInt(id, 10)

    const body = await req.json()
    const parsed = updatePregnancySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Ownership check + update inside the same transaction (no TOCTOU race)
    const pregnancy = await prisma.$transaction(async (tx) => {
      const existing = await tx.patientPregnancy.findFirst({
        where: { id: pregnancyId, patientId },
      })

      if (!existing) {
        throw new Error("pregnancyNotFound")
      }

      const data: Record<string, unknown> = {}
      if (parsed.data.dueDate !== undefined) data.dueDate = new Date(parsed.data.dueDate)
      if (parsed.data.gestationalAge !== undefined) data.gestationalAge = parsed.data.gestationalAge
      if (parsed.data.active !== undefined) data.active = parsed.data.active
      if (parsed.data.notes !== undefined) data.notes = encryptField(parsed.data.notes)

      const updated = await tx.patientPregnancy.update({
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

      return updated
    })

    return NextResponse.json({
      ...pregnancy,
      notes: safeDecryptField(pregnancy.notes),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error && error.message === "pregnancyNotFound") {
      return NextResponse.json({ error: "pregnancyNotFound" }, { status: 404 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/pregnancy/:id PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
