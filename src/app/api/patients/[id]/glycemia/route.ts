import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { encryptField } from "@/lib/crypto/fields"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const glycemiaSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  glycemiaGl: z.number().min(0.20).max(6.00).optional(),
  glycemiaMgdl: z.number().min(20).max(600).optional(),
  weight: z.number().min(20).max(300).optional(),
  hba1c: z.number().min(4.0).max(14.0).optional(),
  ketones: z.number().min(0).max(20).optional(),
  bpSystolic: z.number().int().min(50).max(300).optional(),
  bpDiastolic: z.number().int().min(20).max(200).optional(),
  bolus: z.number().min(0).max(25).optional(),
  basal: z.number().min(0).max(10).optional(),
  carb: z.number().int().min(0).max(500).optional(),
  comment: z.string().max(500).optional(),
})

/** Serialize Decimal fields for JSON */
function serializeEntry(entry: Record<string, unknown>) {
  const decimals = ["glycemiaGl", "glycemiaMgdl", "weight", "hba1c", "ketones", "bolus", "bolusCorr", "basal"]
  const result = { ...entry }
  for (const key of decimals) {
    if (result[key] != null && typeof result[key] === "object") {
      result[key] = Number(result[key])
    }
  }
  return result
}

/** POST /api/patients/:id/glycemia — professional glycemia entry */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)

    const ctx = extractRequestContext(req)
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.log({
        userId: user.id, action: "UNAUTHORIZED", resource: "GLYCEMIA_ENTRY",
        resourceId: String(patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    // Check shareWithProviders
    const patient = await prisma.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { userId: true } })
    if (!patient) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const privacy = await prisma.userPrivacySettings.findUnique({ where: { userId: patient.userId } })
    if (privacy && !privacy.shareWithProviders) {
      return NextResponse.json({ error: "sharingDisabled" }, { status: 403 })
    }

    const body = await req.json()
    const parsed = glycemiaSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.glycemiaEntry.create({
        data: {
          patientId,
          isProfessional: true,
          date: new Date(parsed.data.date),
          time: parsed.data.time ? new Date(`1970-01-01T${parsed.data.time}:00Z`) : null,
          glycemiaGl: parsed.data.glycemiaGl,
          glycemiaMgdl: parsed.data.glycemiaMgdl,
          weight: parsed.data.weight,
          hba1c: parsed.data.hba1c,
          ketones: parsed.data.ketones,
          bpSystolic: parsed.data.bpSystolic,
          bpDiastolic: parsed.data.bpDiastolic,
          bolus: parsed.data.bolus,
          basal: parsed.data.basal,
          carb: parsed.data.carb,
          mealDescription: parsed.data.comment ? encryptField(parsed.data.comment) : null,
        },
      })

      await auditService.logWithTx(tx, {
        userId: user.id,
        action: "CREATE",
        resource: "GLYCEMIA_ENTRY",
        resourceId: String(created.id),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { patientId, isProfessional: true },
      })

      return created
    })

    return NextResponse.json(serializeEntry(entry as unknown as Record<string, unknown>), { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/glycemia POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
