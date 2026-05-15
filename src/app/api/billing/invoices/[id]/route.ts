/**
 * @route /api/billing/invoices/[id]
 * @description GET detail (cabinet member OR patient owner OR ADMIN).
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
    // Authenticated read — fine-grained access enforced post-fetch.
    const user = await auditedRequireRole(
      req, "VIEWER", ctx, "INVOICE", String(parsed.data.id),
    )
    const invoice = await invoiceService.getById(parsed.data.id, user.id, ctx)
    if (!invoice) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    const allowed = await invoiceService.canReadInvoice(user.id, user.role, {
      cabinetId: invoice.cabinetId,
      patientId: invoice.patientId,
    })
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    return NextResponse.json({ invoice })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "billing/invoices/:id GET", ctx.requestId)
  }
}
