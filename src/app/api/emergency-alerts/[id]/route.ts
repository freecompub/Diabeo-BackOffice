/**
 * US-2225/2226 — Emergency alert detail (timeline) + workflow transitions.
 *
 * GET    → DOCTOR/NURSE/ADMIN  — alert detail with actions log + CGM context.
 * PATCH  → DOCTOR/NURSE/ADMIN  — acknowledge or resolve (workflow transition).
 *
 * Authorization happens BEFORE any audit-emitting read to avoid leaking the
 * existence of an alert and producing audit entries on forbidden access.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { extractRequestContext } from "@/lib/services/audit.service"
import { emergencyService } from "@/lib/services/emergency.service"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: Promise<{ id: string }>
}

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    // RGPD Art. 15 — VIEWER (patient role) can read their own alerts.
    // Workflow ops (PATCH) remain NURSE+ via canAccessPatient gate below.
    const user = requireAuth(req)
    const { id: rawId } = await params
    const id = parseId(rawId)
    if (id === null) {
      return NextResponse.json({ error: "invalidAlertId" }, { status: 400 })
    }

    // Authorization first — no audit on forbidden / not-found probing.
    const ref = await emergencyService.loadForAccessCheck(id)
    if (!ref || ref.patient.deletedAt) {
      return NextResponse.json({ error: "alertNotFound" }, { status: 404 })
    }
    const allowed = await canAccessPatient(user.id, user.role, ref.patientId)
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const ctx = extractRequestContext(req)
    const alert = await emergencyService.getDetail(id, user.id, ctx)
    if (!alert) {
      return NextResponse.json({ error: "alertNotFound" }, { status: 404 })
    }

    return NextResponse.json(alert)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "emergency-alerts/[id] GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const patchSchema = z.object({
  action: z.enum(["acknowledge", "resolve"]),
  notes: z.string().max(2000).optional(),
})

const TRANSITION_ERROR_CODES = new Set([
  "alert_not_found",
  "alert_not_open",
  "alert_already_closed",
  "patient_deleted",
])

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id: rawId } = await params
    const id = parseId(rawId)
    if (id === null) {
      return NextResponse.json({ error: "invalidAlertId" }, { status: 400 })
    }

    const body = await req.json()
    const parsed = patchSchema.safeParse(body)
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
      const updated =
        parsed.data.action === "acknowledge"
          ? await emergencyService.acknowledge(id, user.id, parsed.data.notes, ctx)
          : await emergencyService.resolve(id, user.id, parsed.data.notes, ctx)
      return NextResponse.json(updated)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "transitionFailed"
      if (TRANSITION_ERROR_CODES.has(msg)) {
        const status = msg === "alert_not_found" ? 404 : 409
        return NextResponse.json({ error: msg }, { status })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "emergency-alerts/[id] PATCH failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
