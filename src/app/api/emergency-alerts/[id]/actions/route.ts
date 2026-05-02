/**
 * US-2226 — Emergency alert workflow actions log (call patient, adjust treatment, etc.).
 *
 * POST → NURSE+ — append a workflow action without changing alert status.
 *                 The PATCH /[id] endpoint handles status transitions.
 *
 * Authorization is enforced BEFORE any audit-emitting read.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { extractRequestContext } from "@/lib/services/audit.service"
import { emergencyService } from "@/lib/services/emergency.service"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: Promise<{ id: string }>
}

const actionTypeEnum = z.enum([
  "acknowledge",
  "call_patient",
  "adjust_treatment",
  "send_message",
  "resolve",
  "escalate",
])

const postSchema = z.object({
  actionType: actionTypeEnum,
  notes: z.string().max(2000).optional(),
  metadata: z
    .object({
      durationSec: z.number().int().min(0).max(86400).optional(),
      outcome: z.string().max(50).optional(),
    })
    .optional(),
})

const ACTION_ERROR_CODES = new Set([
  "alert_not_found",
  "alert_expired",
  "patient_deleted",
])

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id: rawId } = await params
    const id = Number.parseInt(rawId, 10)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalidAlertId" }, { status: 400 })
    }

    const body = await req.json()
    const parsed = postSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ref = await emergencyService.loadForAccessCheck(id)
    if (!ref || ref.patient.deletedAt) {
      return NextResponse.json({ error: "alertNotFound" }, { status: 404 })
    }
    const allowed = await canAccessPatient(user.id, user.role, ref.patientId)
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const ctx = extractRequestContext(req)
    try {
      const action = await emergencyService.addAction(
        {
          alertId: id,
          performedBy: user.id,
          actionType: parsed.data.actionType,
          notes: parsed.data.notes,
          metadata: parsed.data.metadata,
        },
        ctx,
      )
      return NextResponse.json(action, { status: 201 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "actionFailed"
      if (ACTION_ERROR_CODES.has(msg)) {
        const status = msg === "alert_not_found" ? 404 : 409
        return NextResponse.json({ error: msg }, { status })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "emergency-alerts/[id]/actions POST failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
