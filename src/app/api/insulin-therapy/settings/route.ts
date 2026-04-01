import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { InsulinDeliveryMethod } from "@prisma/client"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinTherapyService, INSULIN_BOUNDS } from "@/lib/services/insulin-therapy.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const updateSchema = z.object({
  patientId: z.number().int().positive().optional(),
  bolusInsulinBrand: z.enum(["humalog", "novorapid", "apidra", "fiasp", "other"]),
  basalInsulinBrand: z.enum(["lantus", "levemir", "tresiba", "other"]).optional(),
  insulinActionDuration: z.number().min(INSULIN_BOUNDS.ACTION_DURATION_MIN).max(INSULIN_BOUNDS.ACTION_DURATION_MAX),
  deliveryMethod: z.nativeEnum(InsulinDeliveryMethod),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const patientId = await resolvePatientId(user.id, user.role, patientIdParam ? parseInt(patientIdParam, 10) : undefined)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const settings = await insulinTherapyService.getSettings(patientId, user.id, ctx)
    if (!settings) return NextResponse.json({ error: "settingsNotFound" }, { status: 404 })
    return NextResponse.json(settings)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[insulin-therapy/settings GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const { patientId: pidParam, ...settingsInput } = parsed.data
    const patientId = await resolvePatientId(user.id, user.role, pidParam)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const result = await insulinTherapyService.upsertSettings(patientId, settingsInput, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[insulin-therapy/settings PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/** DELETE — DOCTOR only, requires GDPR consent */
export async function DELETE(req: NextRequest) {
  try {
    const user = requireRole(req, "DOCTOR")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const patientId = await resolvePatientId(user.id, user.role, patientIdParam ? parseInt(patientIdParam, 10) : undefined)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const result = await insulinTherapyService.deleteSettings(patientId, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[insulin-therapy/settings DELETE]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
