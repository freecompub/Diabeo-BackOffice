import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { requireGdprConsent } from "@/lib/gdpr"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { glycemiaService } from "@/lib/services/glycemia.service"

type RouteParams = { params: Promise<{ id: string }> }

const listQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((d) => d.from < d.to, { message: "from must be before to" })

const measurementFields = [
  "glycemiaGl", "glycemiaMgdl", "weight", "hba1c", "ketones",
  "bpSystolic", "bpDiastolic", "bolus", "basal", "carb",
] as const

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
}).refine(
  (v) => measurementFields.some((k) => v[k] !== undefined),
  { message: "atLeastOneMeasurementRequired" },
)

/**
 * Serialize a GlycemiaEntry for JSON response:
 *  - Decimal fields → number (lossy for sub-double precision but fine clinically)
 *  - mealDescription ciphertext → plaintext (we never leak base64 to the API)
 */
function serializeEntry(entry: Record<string, unknown>) {
  const decimals = ["glycemiaGl", "glycemiaMgdl", "weight", "hba1c", "ketones", "bolus", "bolusCorr", "basal"]
  const result = { ...entry }
  for (const key of decimals) {
    if (result[key] != null && typeof result[key] === "object") {
      result[key] = Number(result[key])
    }
  }
  if (typeof result.mealDescription === "string") {
    result.mealDescription = safeDecryptField(result.mealDescription)
  }
  return result
}

/**
 * GET /api/patients/:id/glycemia?from=&to= — BGM/capillary entries list.
 *
 * US-2032 — Glycémies capillaires (BGM). Backoffice-side read endpoint for
 * the patient detail "BGM" tab; complements the bulk `/api/userdata` route
 * with a focused, per-patient read.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireAuth(req)
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const ctx = extractRequestContext(req)
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.log({
        userId: user.id, action: "UNAUTHORIZED", resource: "GLYCEMIA_ENTRY",
        resourceId: String(patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        metadata: { patientId, endpoint: "list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    // Mirror the POST policy — when sharing is off, do not expose entries.
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null }, select: { userId: true },
    })
    if (!patient) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    const privacy = await prisma.userPrivacySettings.findUnique({
      where: { userId: patient.userId },
    })
    if (privacy && !privacy.shareWithProviders) {
      return NextResponse.json({ error: "sharingDisabled" }, { status: 403 })
    }

    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const entries = await glycemiaService.getGlycemiaEntries(
      patientId, parsed.data.from, parsed.data.to, user.id, ctx,
    )
    return NextResponse.json(entries.map((e) => serializeEntry(e as unknown as Record<string, unknown>)))
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/glycemia GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
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
