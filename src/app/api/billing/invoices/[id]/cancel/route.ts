/**
 * @route POST /api/billing/invoices/[id]/cancel
 * @description FSM `draft|issued → cancelled`. Réservé DOCTOR/ADMIN
 *   membres du cabinet émetteur. Une facture `paid` ne peut plus être
 *   cancelled — utiliser le refund flow (Batch 4 US-2109).
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
  INVOICE_BOUNDS,
} from "@/lib/services/invoice.service"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

// M5 (review PR #406) — bornes partagées service/route.
const bodySchema = z.object({
  reason: z.string().trim().max(INVOICE_BOUNDS.MAX_CANCEL_REASON_LEN).optional(),
})

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
    // C4 — auth avant body.
    const user = await auditedRequireRole(
      req, "DOCTOR", ctx, "INVOICE", String(parsedParams.data.id),
    )

    // H-NEW-3 (review re-2) — parser le body SANS dépendre du header
    // Content-Length (absent en HTTP/2, Transfer-Encoding: chunked).
    // Un body vide ou absent reste valide (reason null) ; seul un body
    // présent ET malformé doit retourner 400.
    let reason: string | null = null
    const rawBody = await req.text()
    if (rawBody.trim() !== "") {
      let bodyJson: unknown
      try {
        bodyJson = JSON.parse(rawBody)
      } catch {
        return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
      }
      const parsedBody = bodySchema.safeParse(bodyJson)
      if (!parsedBody.success) {
        return NextResponse.json(
          { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      reason = parsedBody.data.reason ?? null
    }

    const invoice = await invoiceService.cancel(parsedParams.data.id, reason, user.id, ctx)
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
    return mapErrorToResponse(e, "billing/invoices/:id/cancel POST", ctx.requestId)
  }
}
