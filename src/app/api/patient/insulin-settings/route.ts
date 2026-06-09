/**
 * US-2018b — GET /api/patient/insulin-settings
 *
 * Expose les paramètres d'insulinothérapie d'un patient (schéma basal, ISF/ICR
 * par créneau, config pompe, IOB) pour l'onglet « Traitements » du workspace.
 * Patient résolu via jeton de consultation (`x-consultation-token`) ou
 * `?patientId=` (cf. `resolvePatientIdFromQuery`). Lecture santé → auditée.
 */

import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinService } from "@/lib/services/insulin.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    }

    const ctx = extractRequestContext(req)
    const settings = await insulinService.getSettings(res.patientId)

    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "PATIENT",
      resourceId: String(res.patientId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { patientId: res.patientId, kind: "insulin_settings" },
    })

    return NextResponse.json(settings)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[insulin-settings GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
