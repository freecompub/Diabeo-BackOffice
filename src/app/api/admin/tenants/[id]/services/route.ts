/**
 * US-2613 — Administration plateforme : rattacher un établissement à un tenant.
 *
 * POST → SYSTEM_ADMIN (ADMIN V1) — lie `HealthcareService.tenantId` au tenant
 * `[id]` (l'établissement lui-même n'est pas modifié). Détachement = body
 * `{ serviceId, detach: true }` (met `tenantId = null`).
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

const bodySchema = z.object({
  serviceId: z.number().int().positive(),
  detach: z.boolean().optional(),
})

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "ADMIN")
    const tenantId = parseId((await params).id)
    if (tenantId === null) return NextResponse.json({ error: "invalidTenantId" }, { status: 400 })

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    try {
      await tenantService.assignService(
        parsed.data.serviceId,
        parsed.data.detach ? null : tenantId,
        user.id,
        ctx,
      )
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
    logger.error("api", "admin/tenants/[id]/services POST failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
