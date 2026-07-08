import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { governanceService } from "@/lib/services/governance.service"
import { extractRequestContext } from "@/lib/services/audit.service"

// US-2657 (slice C) — activation/désactivation gouvernée de l'auto-application experte d'un patient.
// Activer exige une `reference` de décision de gouvernance (fail-closed) ; désactiver non (kill direction).
const bodySchema = z
  .object({
    patientId: z.number().int().positive(),
    enabled: z.boolean(),
    reference: z.string().trim().min(1).optional(),
    dpiaRef: z.string().trim().min(1).optional(),
  })
  .refine((b) => !b.enabled || (b.reference !== undefined && b.reference.length > 0), {
    message: "reference required to enable",
    path: ["reference"],
  })
  // DPIA = dépendance dure (MDR / RGPD Art. 35) : obligatoire pour activer, pas seulement `reference`.
  .refine((b) => !b.enabled || (b.dpiaRef !== undefined && b.dpiaRef.length > 0), {
    message: "dpiaRef required to enable",
    path: ["dpiaRef"],
  })

/**
 * PATCH — pose `Patient.autoApply` (frontière MDR). **Réservé au rôle ADMIN** (acte de gouvernance).
 * Activer crée une `GovernanceApproval` (référence + DPIA) dans la transaction ; désactiver est
 * toujours permis. Le flag reste **subordonné au kill-switch global** `AUTO_APPLY_GLOBALLY_ENABLED`
 * (le harnais ne l'auto-applique que si les DEUX sont ON). Anti-IDOR (→ 404), audité sans PHI.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    try {
      const result = await governanceService.setAutoApply(
        patientId,
        parsed.data.enabled,
        parsed.data.enabled ? { reference: parsed.data.reference!, dpiaRef: parsed.data.dpiaRef! } : null,
        user.id,
        extractRequestContext(req),
      )
      return NextResponse.json(result)
    } catch (e) {
      if (
        e instanceof Error &&
        ["patientNotFound", "approvalRequired", "dpiaRequired", "maturityNotExpert"].includes(e.message)
      ) {
        return NextResponse.json({ error: e.message }, { status: e.message === "patientNotFound" ? 404 : 400 })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[governance/auto-apply PATCH]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
