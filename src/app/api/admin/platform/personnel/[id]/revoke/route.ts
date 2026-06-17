/**
 * US-2613 — Administration plateforme : révocation d'appartenance (incident /
 * offboarding) cross-tenant.
 *
 * POST → SYSTEM_ADMIN (ADMIN V1) — body `{ serviceId }`. Délègue à
 * `orgMembershipService.revokeMember` en tant qu'`ADMIN` (bypass scope) : retrait
 * de l'appartenance + révocation immédiate (bump authVersion + invalidate sessions).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  orgMembershipService,
  OrgMembershipError,
  orgMembershipErrorStatus,
} from "@/lib/services/org-membership.service"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: Promise<{ id: string }>
}

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

const bodySchema = z.object({ serviceId: z.number().int().positive() })

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "ADMIN")
    const targetUserId = parseId((await params).id)
    if (targetUserId === null) return NextResponse.json({ error: "invalidUserId" }, { status: 400 })

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    try {
      await orgMembershipService.revokeMember(user.id, "ADMIN", targetUserId, parsed.data.serviceId, ctx)
      return NextResponse.json({ ok: true })
    } catch (e) {
      if (e instanceof OrgMembershipError) {
        return NextResponse.json({ error: e.code }, { status: orgMembershipErrorStatus(e.code) })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/platform/personnel/[id]/revoke POST failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
