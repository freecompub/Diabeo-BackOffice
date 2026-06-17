/**
 * US-2613 — Administration plateforme : bootstrap du premier org-admin.
 *
 * POST → SYSTEM_ADMIN (ADMIN V1) — body `{ serviceId, email, clinicalRole,
 * firstName?, lastName? }`. Invite l'admin principal (Q1+Q2) d'un établissement
 * existant ; refuse si un admin principal existe déjà (409 alreadyBootstrapped).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  platformAdminService,
  PlatformAdminError,
  platformAdminErrorStatus,
} from "@/lib/services/platform-admin.service"
import {
  OrgMembershipError,
  orgMembershipErrorStatus,
} from "@/lib/services/org-membership.service"
import { logger } from "@/lib/logger"

const bodySchema = z.object({
  serviceId: z.number().int().positive(),
  email: z.string().trim().email().max(255),
  // Un org-admin V1 est un utilisateur clinique (DOCTOR/NURSE) — cf. US-2610.
  clinicalRole: z.enum(["DOCTOR", "NURSE"]),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    const { serviceId, email, clinicalRole, firstName, lastName } = parsed.data
    try {
      const result = await platformAdminService.bootstrapOrgAdmin(
        serviceId, { email, clinicalRole, firstName, lastName }, user.id, ctx,
      )
      return NextResponse.json(result, { status: 201 })
    } catch (e) {
      if (e instanceof PlatformAdminError) {
        return NextResponse.json({ error: e.code }, { status: platformAdminErrorStatus(e.code) })
      }
      if (e instanceof OrgMembershipError) {
        return NextResponse.json({ error: e.code }, { status: orgMembershipErrorStatus(e.code) })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/platform/bootstrap POST failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
