/**
 * US-2613 — Administration plateforme : détail / mise à jour d'un tenant.
 *
 * GET   → SYSTEM_ADMIN (ADMIN V1) — détail (+ nb services).
 * PATCH → SYSTEM_ADMIN — mise à jour (nom / pays).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { tenantService, TenantError, tenantErrorStatus } from "@/lib/services/tenant.service"
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
    if (id === null) return NextResponse.json({ error: "invalidTenantId" }, { status: 400 })

    const ctx = extractRequestContext(req)
    try {
      const tenant = await tenantService.getById(id, user.id, ctx)
      return NextResponse.json(tenant)
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
    logger.error("api", "admin/tenants/[id] GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(255).optional(),
    country: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "no fields to update" })

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "ADMIN")
    const id = parseId((await params).id)
    if (id === null) return NextResponse.json({ error: "invalidTenantId" }, { status: 400 })

    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    try {
      await tenantService.update(id, parsed.data, user.id, ctx)
      return NextResponse.json({ ok: true })
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
    logger.error("api", "admin/tenants/[id] PATCH failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
