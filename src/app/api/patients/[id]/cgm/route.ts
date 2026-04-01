import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { prisma } from "@/lib/db/client"

type RouteParams = { params: Promise<{ id: string }> }

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((d) => d.from < d.to, { message: "from must be before to" })

/** GET /api/patients/:id/cgm — pro access to patient CGM data */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)

    // Validate query params FIRST (no timing oracle)
    const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(queryParams)
    if (!parsed.success) return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })

    // Access control BEFORE privacy check (no info leak)
    const ctx = extractRequestContext(req)
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.log({
        userId: user.id, action: "UNAUTHORIZED", resource: "CGM_ENTRY",
        resourceId: String(patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    // Privacy check (shareWithProviders)
    const patient = await prisma.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { userId: true } })
    if (!patient) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const privacy = await prisma.userPrivacySettings.findUnique({ where: { userId: patient.userId } })
    if (privacy && !privacy.shareWithProviders) {
      return NextResponse.json({ error: "sharingDisabled" }, { status: 403 })
    }

    const entries = await glycemiaService.getCgmEntries(patientId, parsed.data.from, parsed.data.to, user.id, ctx)

    // Serialize BigInt id + Decimal valueGl for JSON
    const serialized = entries.map((e) => ({
      ...e,
      id: String(e.id),
      valueGl: Number(e.valueGl),
    }))

    return NextResponse.json(serialized)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/cgm GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
