import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientService } from "@/lib/services/patient.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })
const bodySchema = z.object({ level: z.enum(["JUNIOR", "INTERMEDIATE", "EXPERT"]) })

/**
 * PATCH — pose le **niveau de maturité (autonomie)** d'un patient (US-2657 slice A).
 *
 * **Réservé au rôle EXACTEMENT `DOCTOR`** (acte clinique) : `requireRole` filtre déjà NURSE/VIEWER
 * (min DOCTOR), et l'on **exclut ADMIN** (non-clinicien) explicitement. Le patient ne peut donc
 * **jamais** élever son propre niveau (VIEWER → 403). Scopé patient (anti-IDOR → 404). Idempotent.
 * L'audit `UPDATE PATIENT` (metadata `from → to`) est émis par le service, dans la transaction.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireRole(req, "DOCTOR")
    if (user.role !== "DOCTOR") return NextResponse.json({ error: "forbidden" }, { status: 403 }) // exclut ADMIN
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsedParams = paramsSchema.safeParse(await params)
    if (!parsedParams.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsedBody.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })

    const patientId = await resolvePatientId(user.id, user.role, parsedParams.data.id)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    try {
      const result = await patientService.setMaturityLevel(
        patientId,
        parsedBody.data.level,
        user.id,
        extractRequestContext(req),
      )
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
