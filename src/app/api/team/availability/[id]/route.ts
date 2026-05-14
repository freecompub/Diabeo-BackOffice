/** US-2504 — Delete an unavailability slot. */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { memberUnavailabilityService } from "@/lib/services/rdv.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })

  let user
  try {
    user = await auditedRequireRole(req, "DOCTOR", ctx, "MEMBER_UNAVAILABILITY", id)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/availability/:id DELETE", ctx.requestId)
  }

  try {
    await memberUnavailabilityService.delete(parseInt(id, 10), user.id, ctx)
    return NextResponse.json({ deleted: true })
  } catch (e) {
    // L3 — `ForbiddenError` from the service goes through `mapErrorToResponse`
    //      with `auditTarget` to feed the US-2265 burst detector.
    return mapErrorToResponse(e, "team/availability/:id DELETE", ctx.requestId, {
      user, ctx,
      resource: "MEMBER_UNAVAILABILITY", resourceId: id,
      metadata: { unavailabilityId: id, endpoint: "delete" },
    })
  }
}
