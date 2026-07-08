import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientService } from "@/lib/services/patient.service"
import { extractRequestContext } from "@/lib/services/audit.service"

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
 * **Réservé au rôle EXACTEMENT `DOCTOR`** (acte clinique) : `requireRole` filtre NURSE/VIEWER (min
 * DOCTOR) et l'on **exclut ADMIN** explicitement → un patient (VIEWER) ne peut **jamais** s'auto-élever
 * (403, AC-1). Scopé patient (anti-IDOR → 404). Idempotent. Audit `UPDATE PATIENT` (`from → to`) émis
 * par le service dans la transaction.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = requireRole(req, "DOCTOR")
    if (user.role !== "DOCTOR") return NextResponse.json({ error: "forbidden" }, { status: 403 }) // exclut ADMIN
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
