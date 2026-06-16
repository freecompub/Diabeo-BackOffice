/**
 * US-2603 — Épinglage d'un patient au switcher de contexte (par PS).
 *
 * `POST /api/patients/:id/pin`   → épingle (409 si plafond atteint).
 * `DELETE /api/patients/:id/pin` → désépingle (idempotent).
 *
 * Sécurité (modèle des routes per-patient) : RBAC NURSE+, pré-check existence
 * (404), `canAccessPatient` sinon `accessDenied` + 403 uniforme (anti-énumération),
 * garde consentement `patientShareConsent`, audit `CREATE`/`DELETE` `PINNED_PATIENT`.
 */

import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { recentPatientsService } from "@/lib/services/recent-patients.service"
import { prisma } from "@/lib/db/client"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

async function ensurePatientAlive(patientId: number): Promise<boolean> {
  const p = await prisma.patient.findFirst({
    where: { id: patientId, deletedAt: null }, select: { id: true },
  })
  return !!p
}

/** Gardes communes POST/DELETE : RBAC + existence + accès + consentement. */
async function guard(req: NextRequest, params: RouteParams["params"], endpoint: string) {
  const user = requireRole(req, "NURSE")
  const { id } = await params
  if (!/^\d+$/.test(id)) {
    return { error: NextResponse.json({ error: "invalidPatientId" }, { status: 400 }) }
  }
  const patientId = parseInt(id, 10)
  const ctx = extractRequestContext(req)

  if (!(await ensurePatientAlive(patientId))) {
    return { error: NextResponse.json({ error: "patientNotFound" }, { status: 404 }) }
  }
  if (!(await canAccessPatient(user.id, user.role, patientId))) {
    await auditService.accessDenied({
      userId: user.id, resource: "PINNED_PATIENT", resourceId: String(patientId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { patientId, endpoint },
    })
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  }
  const consent = await patientShareConsent(patientId)
  if (!consent.ok) {
    return { error: NextResponse.json({ error: consent.error }, { status: consent.status }) }
  }
  return { user, patientId, ctx }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const g = await guard(req, params, "pin")
    if ("error" in g) return g.error
    const result = await recentPatientsService.pin(g.user.id, g.patientId, g.user.id, g.ctx)
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 409 })
    }
    return NextResponse.json({ pinned: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/pin POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const g = await guard(req, params, "unpin")
    if ("error" in g) return g.error
    await recentPatientsService.unpin(g.user.id, g.patientId, g.user.id, g.ctx)
    return NextResponse.json({ pinned: false })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/pin DELETE]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
