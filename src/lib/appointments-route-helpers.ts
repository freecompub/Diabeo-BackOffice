/**
 * @module appointments-route-helpers
 * @description Shared gates for `/api/appointments/:id/*` routes. Dedupes the
 * RBAC + access-control + consent chain that was repeated across
 * cancel/propose-alternative/accept-alternative/confirm (M5).
 */

import { NextResponse, type NextRequest } from "next/server"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import {
  auditService,
  extractRequestContext,
  type AuditContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole } from "@/lib/team-route-helpers"
import { AuthError, type AuthUser } from "@/lib/auth"
import type { Role } from "@prisma/client"

export const HOUR_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export type GateResult =
  | { kind: "ok"; user: AuthUser; apptId: number; patientId: number; ctx: AuditContext }
  | { kind: "error"; res: NextResponse }

/**
 * Validates `id` is a positive integer, enforces `minRole`, then runs
 * `canAccessPatient` + `patientShareConsent` for the patient owning the
 * appointment. Emits `accessDenied()` audit on RBAC/access failure.
 *
 * H6 — `AuthError` from `auditedRequireRole` is caught internally so callers
 * can rely purely on the `GateResult` discriminated union (no implicit throw
 * across the type contract).
 */
export async function appointmentRouteGate(
  req: NextRequest,
  rawId: string,
  minRole: Role,
  endpoint: string,
): Promise<GateResult> {
  const ctx = extractRequestContext(req)
  if (!/^\d+$/.test(rawId)) {
    return { kind: "error", res: NextResponse.json({ error: "invalidId" }, { status: 400 }) }
  }
  const apptId = parseInt(rawId, 10)
  // L4 — use String(apptId) for resourceId so forensics are consistent with
  //      the parsed int and not confused by leading-zero strings.
  const resourceId = String(apptId)
  let user: AuthUser
  try {
    user = await auditedRequireRole(req, minRole, ctx, "APPOINTMENT", resourceId)
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        kind: "error",
        res: NextResponse.json({ error: err.message }, { status: err.status }),
      }
    }
    throw err
  }

  const patientId = await rdvAppointmentService.getPatientIdFor(apptId)
  if (patientId === null) {
    return { kind: "error", res: NextResponse.json({ error: "notFound" }, { status: 404 }) }
  }
  const allowed = await canAccessPatient(user.id, user.role, patientId)
  if (!allowed) {
    await auditService.accessDenied({
      userId: user.id, resource: "APPOINTMENT", resourceId,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { patientId, endpoint },
    })
    return { kind: "error", res: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  }
  // H12 — consent gate on every mutation that touches patient-scoped data.
  const consent = await patientShareConsent(patientId)
  if (!consent.ok) {
    return {
      kind: "error",
      res: NextResponse.json({ error: consent.error }, { status: consent.status }),
    }
  }
  return { kind: "ok", user, apptId, patientId, ctx }
}
