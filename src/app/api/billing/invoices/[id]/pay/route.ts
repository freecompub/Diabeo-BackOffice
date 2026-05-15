/**
 * @route POST /api/billing/invoices/[id]/pay
 * @description FSM `issued → paid`. Réservé DOCTOR/ADMIN membres du
 *   cabinet émetteur. Stripe paymentIntentId pris en charge en Batch 3
 *   (US-2106 webhooks) — ici, on accepte le manuel (bank_transfer/cash).
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

const bodySchema = z.object({
  paymentMethod: z.enum(["stripe", "bank_transfer", "cash", "other"]),
  stripePaymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/).max(50).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsedBody = bodySchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const user = await auditedRequireRole(
      req, "DOCTOR", ctx, "INVOICE", String(parsedParams.data.id),
    )
    const invoice = await invoiceService.markPaid(
      parsedParams.data.id,
      parsedBody.data.paymentMethod,
      user.id, ctx,
      parsedBody.data.stripePaymentIntentId,
    )
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
    return mapErrorToResponse(e, "billing/invoices/:id/pay POST", ctx.requestId)
  }
}
