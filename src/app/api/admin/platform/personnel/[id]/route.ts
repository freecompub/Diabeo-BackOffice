/**
 * US-2613 — Administration plateforme : vue personnel cross-tenant.
 *
 * GET → SYSTEM_ADMIN (ADMIN V1) — identité (PII admin) + appartenances/capacités
 * d'un compte. Aucune donnée de santé.
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  platformAdminService,
  PlatformAdminError,
  platformAdminErrorStatus,
} from "@/lib/services/platform-admin.service"
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
    const user = requireRole(req, "ADMIN")
    const id = parseId((await params).id)
    if (id === null) return NextResponse.json({ error: "invalidUserId" }, { status: 400 })

    const ctx = extractRequestContext(req)
    try {
      const view = await platformAdminService.getUserCapabilities(id, user.id, ctx)
      return NextResponse.json(view)
    } catch (e) {
      if (e instanceof PlatformAdminError) {
        return NextResponse.json({ error: e.code }, { status: platformAdminErrorStatus(e.code) })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/platform/personnel/[id] GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
