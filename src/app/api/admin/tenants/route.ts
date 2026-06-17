/**
 * US-2613 — Administration plateforme : tenants.
 *
 * GET  → SYSTEM_ADMIN (ADMIN V1) — liste des tenants (+ nb services).
 * POST → SYSTEM_ADMIN — création d'un tenant.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { tenantService, TenantError, tenantErrorStatus } from "@/lib/services/tenant.service"
import { logger } from "@/lib/logger"

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const ctx = extractRequestContext(req)
    const items = await tenantService.list(user.id, ctx)
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/tenants GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(255),
  country: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).optional().nullable(),
})

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const ctx = extractRequestContext(req)
    try {
      const created = await tenantService.create(parsed.data, user.id, ctx)
      return NextResponse.json(created, { status: 201 })
    } catch (e) {
      if (e instanceof TenantError) {
        return NextResponse.json({ error: e.code }, { status: tenantErrorStatus(e.code) })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/tenants POST failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
