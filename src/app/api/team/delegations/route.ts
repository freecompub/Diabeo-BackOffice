/**
 * US-2083 — Délégation IDE → DOCTOR.
 *
 * Review PR #390 :
 *  - C1 : `canAccessPatient` + `patientShareConsent` avant tout write.
 *  - H1 : `auditedRequireRole` émet `accessDenied()` sur RBAC fail.
 *  - H5 : payload Zod strict + reject côté service via `validateDelegationPayload`.
 *  - H8 : `toUserId` membership-validation côté service.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { delegationRequestService } from "@/lib/services/team-workflow.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const createSchema = z.object({
  patientId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
  action: z.string().min(1).max(80),
  // H5 — accept JSON object only (no scalar / array / nested-array PHI dump).
  payload: z.record(z.string(), z.unknown()).optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "DELEGATION_REQUEST", "inbox")
    const items = await delegationRequestService.listInbox(user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/delegations GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "DELEGATION_REQUEST", "create")
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // C1 — caller must have access to the target patient.
    const allowed = await canAccessPatient(user.id, user.role, parsed.data.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "DELEGATION_REQUEST",
        resourceId: String(parsed.data.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: parsed.data.patientId, endpoint: "create" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(parsed.data.patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const row = await delegationRequestService.create(
      {
        patientId: parsed.data.patientId,
        fromUserId: user.id,
        toUserId: parsed.data.toUserId,
        action: parsed.data.action,
        payload: parsed.data.payload,
      },
      ctx,
    )
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/delegations POST", ctx.requestId)
  }
}
