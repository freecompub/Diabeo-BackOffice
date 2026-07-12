import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

type RouteParams = { params: Promise<{ id: string }> }

const acceptSchema = z.object({
  applyImmediately: z.boolean().default(false),
})

/** PATCH /api/adjustment-proposals/:id/accept — accept proposal (DOCTOR only + access control) */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const { id } = await params

    // Verify the doctor has access to this patient
    const proposal = await prisma.adjustmentProposal.findUnique({
      where: { id },
      select: { patientId: true, status: true },
    })
    if (!proposal || proposal.status !== "pending") {
      return NextResponse.json({ error: "proposalNotFound" }, { status: 404 })
    }

    const allowed = await canAccessPatient(user.id, user.role, proposal.patientId)
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const body = await req.json()
    const parsed = acceptSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const result = await adjustmentService.accept(id, user.id, parsed.data.applyImmediately, ctx)
    const { notified } = await adjustmentService.notifyPatient(result.patientId, user.id, "accepted", ctx)
    return NextResponse.json({ ...result, notified })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "proposalNotFound") {
      return NextResponse.json({ error: "proposalNotFound" }, { status: 404 })
    }
    if (error instanceof Error && error.message === "valueOutOfBounds") {
      return NextResponse.json({ error: "valueOutOfBounds" }, { status: 400 })
    }
    // US-2649b — base déplacée depuis la proposition (compare-and-swap) : 409 Conflict,
    // le client doit régénérer une proposition sur la valeur courante réelle.
    if (error instanceof Error && error.message === "baselineMoved") {
      return NextResponse.json({ error: "baselineMoved" }, { status: 409 })
    }
    // US-2660 — fail-closed « cible disparue / dérivée dans la fenêtre TOCTOU » : conflit métier
    // récupérable côté client (régénérer la proposition), PAS une panne serveur. 409 Conflict
    // (aligné sur `baselineMoved`) plutôt qu'un 500 générique — évite un faux positif d'alerte SOC
    // sur un cas nominal. Couvre les 5 leviers (créneau ISF/ICR/pompe/dose fixe + dose stylo effacée).
    const notFoundCodes = [
      "isfSlotNotFound",
      "icrSlotNotFound",
      "pumpSlotNotFound",
      "fixedDoseSlotNotFound",
      "styloBasalNotFound",
    ]
    if (error instanceof Error && notFoundCodes.includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    // US-2660 — invariants internes fail-closed (ne devraient jamais survenir en prod : garantis par
    // le CHECK base d'exclusivité et par `resolveCurrentValue`). 422 Unprocessable plutôt qu'un 500
    // muet : la proposition n'est pas applicable en l'état.
    if (error instanceof Error && ["basalTargetAmbiguous", "noApplicableApplyTarget"].includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    logger.error("proposals/accept", "Accept failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
