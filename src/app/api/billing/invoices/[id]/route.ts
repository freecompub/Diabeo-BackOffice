/**
 * @route /api/billing/invoices/[id]
 * @description GET detail. Le contrôle d'accès est intégré au service
 * `getById` (C3/H5 review PR #406) : fetch → canRead → audit READ
 * (succès) ou `accessDenied` (échec) → null. On mappe systématiquement
 * `null` à 404 pour éviter l'énumération par timing.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import { invoiceService } from "@/lib/services/invoice.service"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const raw = await params
    const parsed = paramsSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(
      req, "VIEWER", ctx, "INVOICE", String(parsed.data.id),
    )
    const invoice = await invoiceService.getById(
      parsed.data.id, user.id, user.role, ctx,
    )
    if (!invoice) {
      // C3 (review PR #406) — Service mappe non-existence ET access-
      // denied au même `null` ; le 404 protège contre l'énumération.
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    return NextResponse.json({ invoice })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "billing/invoices/:id GET", ctx.requestId)
  }
}
