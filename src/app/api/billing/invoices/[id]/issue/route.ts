/**
 * @route POST /api/billing/invoices/[id]/issue
 * @description FSM `draft → issued`. Assigne le numéro séquentiel
 *   (US-2105 gap-less) et fige les snapshots immutables (US-2107).
 *   Réservé DOCTOR/ADMIN membres du cabinet émetteur.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import {
  invoiceService,
  InvoiceAccessError,
  InvoiceStateError,
  InvoiceNotFoundError,
} from "@/lib/services/invoice.service"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

export async function POST(
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
      req, "DOCTOR", ctx, "INVOICE", String(parsed.data.id),
    )
    const invoice = await invoiceService.issue(parsed.data.id, user.id, ctx)
    return NextResponse.json({ invoice })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof InvoiceNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    if (e instanceof InvoiceAccessError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    if (e instanceof InvoiceStateError) {
      return NextResponse.json({ error: "invalidTransition", from: e.from, to: e.to }, { status: 409 })
    }
    return mapErrorToResponse(e, "billing/invoices/:id/issue POST", ctx.requestId)
  }
}
