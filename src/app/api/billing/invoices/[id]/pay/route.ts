/**
 * @route POST /api/billing/invoices/[id]/pay
 * @description FSM `issued → paid`. Réservé DOCTOR/ADMIN membres du
 *   cabinet émetteur. H8 (review PR #406) — discriminated union
 *   Zod : `paymentMethod=stripe` exige `stripePaymentIntentId`.
 *
 * C4 (review PR #406) — Auth d'abord, body après.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse, assertJsonContentType } from "@/lib/team-route-helpers"
import {
  invoiceService,
  InvoiceAccessError,
  InvoiceStateError,
  InvoiceConcurrencyError,
  InvoiceNotFoundError,
  InvoiceValidationError,
  STRIPE_PAYMENT_INTENT_ID_REGEX,
} from "@/lib/services/invoice.service"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

// H8 (review PR #406) + L-RR3-1 (review re-3) — Stripe exige
// paymentIntentId au format unifié (constante partagée service/route).
// Autres méthodes l'interdisent (discriminated union).
const bodySchema = z.discriminatedUnion("paymentMethod", [
  z.object({
    paymentMethod: z.literal("stripe"),
    stripePaymentIntentId: z.string().regex(STRIPE_PAYMENT_INTENT_ID_REGEX),
  }),
  z.object({
    paymentMethod: z.enum(["bank_transfer", "cash", "other"]),
  }),
])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    // L-RR3-4 (review re-3) — Content-Type guard.
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    // C4 — auth avant parsing du body.
    const user = await auditedRequireRole(
      req, "DOCTOR", ctx, "INVOICE", String(parsedParams.data.id),
    )

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsedBody = bodySchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const data = parsedBody.data
    const stripePI = data.paymentMethod === "stripe" ? data.stripePaymentIntentId : undefined
    const invoice = await invoiceService.markPaid(
      parsedParams.data.id, data.paymentMethod, user.id, ctx, stripePI,
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
    if (e instanceof InvoiceConcurrencyError) {
      return NextResponse.json({ error: "concurrentUpdate", current: e.current, expected: e.expected, retryable: true }, { status: 409 })
    }
    if (e instanceof InvoiceStateError) {
      return NextResponse.json({ error: "invalidTransition", from: e.from, to: e.to }, { status: 409 })
    }
    if (e instanceof InvoiceValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    return mapErrorToResponse(e, "billing/invoices/:id/pay POST", ctx.requestId)
  }
}
