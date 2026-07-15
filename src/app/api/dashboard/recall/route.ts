import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

/**
 * POST /api/dashboard/recall — trace une relance patient (D6).
 *
 * Les cartes « Relances en attente » (home médecin + infirmier) proposent des
 * liens natifs `tel:`/`sms:`. Ce geste de contact patient était jusqu'ici NON
 * tracé (trou de traçabilité HDS). Cette route écrit un `AuditLog`
 * (`action = RECALL_INITIATED`, `resource = PATIENT`, `metadata.channel`) au
 * clic, sans bloquer l'ouverture du lien natif (appel fire-and-forget côté client).
 *
 * L'envoi effectif du SMS (Twilio) et la table `PatientRecallLog` restent différés
 * (US-2800 / V2) — ici on ne journalise QUE l'initiation par le soignant.
 *
 * RBAC : `requireRole(NURSE)` (hiérarchique : NURSE + DOCTOR + ADMIN), aligné sur
 * qui voit la carte. Scope patient vérifié (`canAccessPatient`) — anti-IDOR : on
 * n'audite jamais une relance sur un patient hors périmètre.
 */
const bodySchema = z.object({
  patientId: z.number().int().positive(),
  channel: z.enum(["tel", "sms"]),
})

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const ctx = extractRequestContext(req)

    const body = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const { patientId, channel } = parsed.data

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id,
        resource: "PATIENT",
        resourceId: String(patientId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { patientId, reason: "recall_out_of_scope" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    await auditService.log({
      userId: user.id,
      action: "RECALL_INITIATED",
      resource: "PATIENT",
      resourceId: String(patientId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      // ADR #18 — pivot per-patient pour la forensique CNIL/ANS.
      metadata: { patientId, channel },
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[dashboard/recall POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
