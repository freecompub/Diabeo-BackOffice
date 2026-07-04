import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"

/**
 * GET /api/insulin-therapy/capability?patientId= — **capability descriptor** d'édition
 * insuline (US-2648b). Pilote l'onglet Traitements de la fiche : mode de traitement +
 * `canEditDirect` / `canPropose` + `editableParameters` (+ `blockedReason`).
 *
 * Accès : `resolvePatientId` (VIEWER → SON dossier, ignore `patientId` ; pro →
 * `canAccessPatient`). Ne renvoie **aucune** valeur de dose (juste le mode + les capacités).
 */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const patientId = await resolvePatientId(
      user.id,
      user.role,
      patientIdParam ? parseInt(patientIdParam, 10) : undefined,
    )
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const capability = await treatmentModeService.getInsulinEditCapability(user.role, patientId)
    return NextResponse.json(capability)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    if (msg === "patientNotFound") return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    console.error("[insulin-therapy/capability GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
