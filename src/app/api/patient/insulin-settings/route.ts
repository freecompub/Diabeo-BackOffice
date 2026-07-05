/**
 * GET /api/patient/insulin-settings — lecture SELF-SERVICE PATIENT (US-2650).
 *
 * Expose les paramètres d'insulinothérapie (schéma basal, ISF/ICR par créneau,
 * config pompe, IOB) du patient connecté, pour son espace patient.
 *
 * **Own-id STRICT (anti-IDOR / anti-énumération)** : le patient est résolu
 * EXCLUSIVEMENT depuis `user.id` via `getOwnPatientId` — **aucun** `?patientId`,
 * **aucun** `x-consultation-token`. Un utilisateur sans dossier patient (pro) →
 * `getOwnPatientId` renvoie `null` → 404 neutre. Le workspace PRO lit l'insuline
 * via la fiche `/patients/[id]` (onglet Traitements), pas cette route.
 * Lecture santé → auditée.
 */

import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinService } from "@/lib/services/insulin.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    // Own-id strict : jamais depuis l'URL/token. `null` (pas de dossier patient) → 404 neutre.
    const patientId = await getOwnPatientId(user.id)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const settings = await insulinService.getSettings(patientId)

    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "PATIENT",
      resourceId: String(patientId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { patientId, kind: "insulin_settings" },
    })

    return NextResponse.json(settings)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[insulin-settings GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
