/** US-2123 — List FHIR sync status (DOCTOR/ADMIN). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { FhirSyncStatus } from "@prisma/client"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { fhirInteropService } from "@/lib/services/fhir-interop.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const listSchema = z.object({
  patientId: z.coerce.number().int().positive().optional(),
  syncStatus: z.enum(FhirSyncStatus).optional(),
  resourceType: z.enum(["Patient"]).optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = listSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "FHIR_INTEROP", "sync-status")

    if (parsed.data.patientId !== undefined) {
      const allowed = await canAccessPatient(user.id, user.role, parsed.data.patientId)
      if (!allowed) {
        await auditService.accessDenied({
          userId: user.id, resource: "FHIR_INTEROP",
          resourceId: String(parsed.data.patientId),
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
          metadata: { patientId: parsed.data.patientId, endpoint: "fhir-sync-status" },
        })
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
    } else if (user.role !== "ADMIN") {
      // Global view is ADMIN-only ; DOCTOR must scope by patientId.
      return NextResponse.json({ error: "scopeRequired" }, { status: 400 })
    }

    const out = await fhirInteropService.listStatus(parsed.data)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "interop/fhir/sync-status GET", ctx.requestId)
  }
}
