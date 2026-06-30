/**
 * US-2633 — GET /api/patients/record
 *
 * Renvoie le DTO complet de la fiche patient (`PatientRecordData`) pour
 * alimenter le composant présentational `<PatientRecord>` côté client. Sert les
 * **deux** stratégies de résolution (cf. `resolvePatientIdFromQuery`) :
 *  - drawer de consultation : jeton `x-consultation-token` (aucun id en URL) ;
 *  - mode page / refetch : `?patientId=` (scope route pro).
 *
 * Gardes (alignées sur les routes patient riches en PHI — heatmap/compare/agp) :
 * `requireAuth` → rate-limit → `requireGdprConsent` (appelant) → résolution +
 * scope patient (RBAC / jeton) → **`patientShareConsent`** (opt-out du SUJET,
 * RGPD Art. 7.3/21, fail-closed) AVANT toute projection. L'assemblage
 * (`buildPatientRecordData`) audite chaque agrégat ; une ligne « surface »
 * (fail-soft, sans PHI) distingue l'accès route/drawer de l'accès page RSC.
 */

import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, getAuthUser, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientShareConsent } from "@/lib/consent"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { buildPatientRecordData } from "@/app/(dashboard)/patients/[id]/build-patient-record"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)

  let user
  try {
    user = requireAuth(req)
  } catch (e) {
    if (e instanceof AuthError) {
      const u = getAuthUser(req)
      if (u && e.status === 403) {
        await auditService.accessDenied({
          userId: u.id, resource: "PATIENT", resourceId: "record",
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
          metadata: { surface: "api", kind: "patientRecord" },
        })
      }
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }

  try {
    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.analytics)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      )
    }

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      // Détection d'énumération (US-2265) : tracer la tentative hors périmètre.
      // `?patientId=` brut récupéré best-effort pour le forensic ; jamais de PHI.
      if (res.error === "patientNotFound") {
        const raw = req.nextUrl.searchParams.get("patientId")
        await auditService.accessDenied({
          userId: user.id, resource: "PATIENT",
          resourceId: raw && /^\d+$/.test(raw) ? raw : "unknown",
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
          metadata: { surface: "api", kind: "patientRecord", reason: res.error },
        })
      }
      return NextResponse.json(
        { error: res.error },
        { status: res.error === "invalidPatientId" ? 400 : 404 },
      )
    }
    const patientId = res.patientId

    // Opt-out du SUJET (gdprConsent + shareWithProviders, fail-closed) — même
    // garde que la page RSC et les routes analytics : un patient en opt-out de
    // partage n'est pas exposé, même à un PS RBAC-autorisé.
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error }, { status: consent.status })
    }

    const data = await buildPatientRecordData(patientId, user.role, user.id, ctx)
    if (!data) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    // Ligne d'audit « surface » (sans PHI) — fail-soft : un échec ne doit pas
    // transformer une lecture réussie (déjà auditée par agrégat) en 500.
    await auditService
      .log({
        userId: user.id, action: "READ", resource: "PATIENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, kind: "patientRecord", surface: "api" },
      })
      .catch((e) => console.error("[patients/record] surface audit failed", e instanceof Error ? e.message : e))

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
