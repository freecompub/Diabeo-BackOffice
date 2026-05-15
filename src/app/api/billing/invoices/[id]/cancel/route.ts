/**
 * @route POST /api/billing/invoices/[id]/cancel
 * @description FSM `draft|issued → cancelled`. Réservé DOCTOR/ADMIN
 *   membres du cabinet émetteur. Une facture `paid` ne peut plus être
 *   cancelled — utiliser le refund flow (Batch 4 US-2109).
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
  reason: z.string().trim().max(200).optional(),
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
    let reason: string | null = null
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      const body = await req.json().catch(() => null)
      if (body !== null) {
        const parsedBody = bodySchema.safeParse(body)
        if (!parsedBody.success) {
          return NextResponse.json(
            { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
            { status: 400 },
          )
        }
        reason = parsedBody.data.reason ?? null
      }
    }

    const user = await auditedRequireRole(
      req, "DOCTOR", ctx, "INVOICE", String(parsedParams.data.id),
    )
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
    if (e instanceof InvoiceStateError) {
      return NextResponse.json({ error: "invalidTransition", from: e.from, to: e.to }, { status: 409 })
    }
    return mapErrorToResponse(e, "billing/invoices/:id/cancel POST", ctx.requestId)
  }
}
