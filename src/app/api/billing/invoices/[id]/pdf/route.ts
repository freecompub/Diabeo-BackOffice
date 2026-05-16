/**
 * @route POST/GET /api/billing/invoices/[id]/pdf
 * @description US-2102 — Génération + téléchargement PDF facture.
 *
 *   - POST : génère le PDF (idempotent si déjà généré) — retourne `pdfUrl + pdfHash`.
 *   - GET : stream le PDF depuis S3 (Content-Type: application/pdf).
 *
 * Auth : VIEWER (patient owner via canReadInvoice) / NURSE+ (cabinet).
 * Audit : `INVOICE/UPDATE` (generate) ou `INVOICE/READ` (download).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import {
  invoicePdfService,
  InvoicePdfNotFoundError,
  InvoicePdfAccessError,
  InvoicePdfStateError,
  InvoicePdfRenderError,
} from "@/lib/services/invoice-pdf.service"

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
    const user = requireAuth(req)
    try {
      const result = await invoicePdfService.generate(
        parsed.data.id, user.id, user.role, ctx,
      )
      return NextResponse.json(result, {
        status: result.regenerated ? 201 : 200,
        headers: { "Cache-Control": "no-store, private" },
      })
    } catch (e) {
      if (e instanceof InvoicePdfNotFoundError) {
        return NextResponse.json({ error: "notFound" }, { status: 404 })
      }
      if (e instanceof InvoicePdfAccessError) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      if (e instanceof InvoicePdfStateError) {
        return NextResponse.json(
          { error: "invalidState", actual: e.actual, expected: e.expected },
          { status: 409 },
        )
      }
      if (e instanceof InvoicePdfRenderError) {
        return NextResponse.json(
          { error: "renderFailed", reason: e.message },
          { status: 500 },
        )
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "billing/invoices/:id/pdf POST", ctx.requestId)
  }
}

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
    const user = requireAuth(req)
    try {
      const file = await invoicePdfService.download(
        parsed.data.id, user.id, user.role, ctx,
      )
      return new NextResponse(file.body, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          ...(file.contentLength !== undefined && {
            "Content-Length": String(file.contentLength),
          }),
          "Content-Disposition": `attachment; filename="invoice-${parsed.data.id}.pdf"`,
          "Cache-Control": "no-store, private",
          "X-Content-SHA256": file.pdfHash,
        },
      })
    } catch (e) {
      if (e instanceof InvoicePdfNotFoundError) {
        return NextResponse.json({ error: "notFound" }, { status: 404 })
      }
      if (e instanceof InvoicePdfAccessError) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      if (e instanceof InvoicePdfStateError) {
        return NextResponse.json(
          { error: "invalidState", actual: e.actual, expected: e.expected },
          { status: 409 },
        )
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "billing/invoices/:id/pdf GET", ctx.requestId)
  }
}
