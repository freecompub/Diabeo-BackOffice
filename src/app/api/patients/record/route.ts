/**
 * US-2633 — GET /api/patients/record
 *
 * Renvoie le DTO complet de la fiche patient (`PatientRecordData`) pour
 * alimenter le composant présentational `<PatientRecord>` côté client. Sert les
 * **deux** stratégies de résolution (cf. `resolvePatientIdFromQuery`) :
 *  - drawer de consultation : jeton `x-consultation-token` (aucun id en URL) ;
 *  - mode page / refetch : `?patientId=` (scope route pro).
 *
 * Gardes : `requireAuth` → `requireGdprConsent` → résolution + scope patient
 * (RBAC portefeuille / jeton) AVANT toute projection. L'assemblage
 * (`buildPatientRecordData`) audite chaque agrégat (READ PATIENT / ANALYTICS /
 * CGM_ENTRY / INSULIN_THERAPY / MEDICAL_DOCUMENT) ; on ajoute une ligne « surface »
 * pour distinguer l'accès drawer/route de l'accès page RSC (forensique HDS).
 */

import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { buildPatientRecordData } from "@/app/(dashboard)/patients/[id]/build-patient-record"

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      return NextResponse.json(
        { error: res.error },
        { status: res.error === "invalidPatientId" ? 400 : 404 },
      )
    }

    const ctx = extractRequestContext(req)
    const data = await buildPatientRecordData(res.patientId, user.role, user.id, ctx)
    if (!data) return NextResponse.json({ error: "notFound" }, { status: 404 })

    // Ligne d'audit « surface » (sans PHI) : distingue l'accès via cette route
    // (drawer/refetch) de l'accès page RSC ; les agrégats sont déjà audités.
    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "PATIENT",
      resourceId: String(res.patientId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { patientId: res.patientId, kind: "patientRecord", surface: "api" },
    })

    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/record GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
