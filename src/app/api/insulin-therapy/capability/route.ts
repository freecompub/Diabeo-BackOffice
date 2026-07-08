import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

/**
 * GET /api/insulin-therapy/capability?patientId= — **capability descriptor** d'édition
 * insuline (US-2648b). Pilote l'onglet Traitements de la fiche : mode de traitement +
 * `canEditDirect` / `canPropose` / `canEditSlots` (restructuration, gatée maturité pour le patient) +
 * `maturityLevel` + `editableParameters` (+ `blockedReason`).
 *
 * Accès : `resolvePatientIdFromQuery` — **transport-agnostic** (ADR #21) : page =
 * `?patientId=` (+ `canAccessPatient`), drawer = en-tête `x-consultation-token` ;
 * VIEWER → SON dossier. Cohérent avec les 13 routes analytics (le bandeau ne doit pas
 * disparaître en mode drawer). Ne renvoie **aucune** valeur de dose (mode + capacités).
 */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    }
    const patientId = res.patientId

    const capability = await treatmentModeService.getInsulinEditCapability(user.role, patientId)

    // Audit READ — la résolution du mode révèle une donnée de santé (patient sous
    // insuline ou non). Cohérent avec getSettings ; pivot patientId (US-2268/ADR #18).
    const ctx = extractRequestContext(req)
    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "INSULIN_THERAPY",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { patientId, view: "capability" },
    })

    return NextResponse.json(capability)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    if (msg === "patientNotFound") return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    console.error("[insulin-therapy/capability GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
