import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientService } from "@/lib/services/patient.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

// US-2657 (slice A2) — corps porteur du `patientId` (injecté par le transport de mutation de la fiche
// unifiée, anti-énumération) + niveau désiré. Le scope réel est résolu serveur (`resolvePatientId`).
const bodySchema = z.object({
  patientId: z.number().int().positive().optional(),
  level: z.enum(["JUNIOR", "INTERMEDIATE", "EXPERT"]),
})

/**
 * PATCH — pose le **niveau de maturité (autonomie)** d'un patient (US-2657). Compatible avec le
 * transport de mutation de la fiche unifiée (`patientId` dans le corps).
 *
 * **Réservé au rôle EXACTEMENT `DOCTOR`** (acte clinique) : `requireAuth` (401 si non authentifié) puis
 * garde `user.role !== "DOCTOR"` → **exclut NURSE/VIEWER ET ADMIN**. Tout non-DOCTOR est refusé (403) et la
 * tentative est tracée par l'action d'audit dédiée `MATURITY_LEVEL_SELF_ELEVATION_DENIED` (AC-1 : un patient
 * VIEWER ne peut jamais s'auto-élever). Scopé patient (anti-IDOR → 404). Idempotent. Audit
 * `MATURITY_LEVEL_CHANGED` (`from → to`, + `AUTO_APPLY_FLAG_CHANGED` si downgrade) émis par le service.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = requireAuth(req) // 401 si non authentifié
    // **Exactement DOCTOR** (acte clinique) : on exclut NURSE/VIEWER ET ADMIN. Tout non-DOCTOR est une
    // tentative hors autorité clinique — dont l'auto-élévation d'un patient (VIEWER) : tracée par une
    // action d'audit DÉDIÉE (AC-1) avant le 403, plutôt qu'un UNAUTHORIZED générique.
    if (user.role !== "DOCTOR") {
      const attemptedPatientId = z.number().int().positive().safeParse((await req.json().catch(() => null))?.patientId)
      const rc = extractRequestContext(req)
      await auditService
        .log({
          userId: user.id,
          action: "MATURITY_LEVEL_SELF_ELEVATION_DENIED",
          resource: "PATIENT",
          resourceId: String(user.id),
          ipAddress: rc.ipAddress,
          userAgent: rc.userAgent,
          requestId: rc.requestId,
          metadata: { attemptedRole: user.role, ...(attemptedPatientId.success ? { attemptedPatientId: attemptedPatientId.data } : {}) },
        })
        .catch(() => {})
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    try {
      const result = await patientService.setMaturityLevel(patientId, parsed.data.level, user.id, extractRequestContext(req))
      return NextResponse.json(result)
    } catch (e) {
      if (e instanceof Error && e.message === "patientNotFound") {
        return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/maturity PATCH]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
