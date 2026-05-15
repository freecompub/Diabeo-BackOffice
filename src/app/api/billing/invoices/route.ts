/**
 * @route /api/billing/invoices
 * @description Groupe 7 Batch 1 — list + create draft invoice.
 *   - GET  : list cabinet (`?cabinetId=…`) or patient (`?patientId=…`)
 *   - POST : create DRAFT (DOCTOR/ADMIN — cabinet member only)
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import {
  invoiceService,
  InvoiceValidationError,
  InvoiceAccessError,
  InvoiceStateError,
  InvoiceNotFoundError,
} from "@/lib/services/invoice.service"

const listQuerySchema = z.object({
  cabinetId: z.coerce.number().int().positive().optional(),
  patientId: z.coerce.number().int().positive().optional(),
  status: z.enum(["draft", "issued", "paid", "cancelled", "refunded"]).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
}).refine((d) => !!d.cabinetId !== !!d.patientId, {
  message: "exactly one of cabinetId | patientId is required",
})

const itemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(1000),
  unitPriceCents: z.number().int().nonnegative().max(1_000_000),
  taxRate: z.number().min(0).max(1),
  teleconsultActeId: z.number().int().positive().optional(),
})

const createSchema = z.object({
  cabinetId: z.number().int().positive(),
  patientId: z.number().int().positive().nullable().optional(),
  countryCode: z.string().length(2).regex(/^[A-Za-z]{2}$/),
  currency: z.string().length(3).regex(/^[A-Za-z]{3}$/),
  items: z.array(itemSchema).min(1).max(100),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const q = parsed.data

    if (q.cabinetId) {
      const user = await auditedRequireRole(
        req, "NURSE", ctx, "INVOICE", `cabinet:${q.cabinetId}`,
      )
      const items = await invoiceService.listByCabinet(
        q.cabinetId,
        { status: q.status, cursor: q.cursor, limit: q.limit },
        user.id, ctx,
      )
      return NextResponse.json({ items })
    }

    // patientId branch — NURSE+ pour pro, VIEWER pour le patient lui-même.
    const user = await auditedRequireRole(
      req, "VIEWER", ctx, "INVOICE", `patient:${q.patientId}`,
    )
    const items = await invoiceService.listByPatient(
      q.patientId!,
      { cursor: q.cursor, limit: q.limit },
      user.id, ctx,
    )
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "billing/invoices GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(
      req, "DOCTOR", ctx, "INVOICE", `cabinet:${parsed.data.cabinetId}`,
    )
    const invoice = await invoiceService.createDraft(parsed.data, user.id, ctx)
    return NextResponse.json({ invoice }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof InvoiceValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    if (e instanceof InvoiceAccessError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    if (e instanceof InvoiceStateError) {
      return NextResponse.json({ error: "invalidTransition", from: e.from, to: e.to }, { status: 409 })
    }
    if (e instanceof InvoiceNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    return mapErrorToResponse(e, "billing/invoices POST", ctx.requestId)
  }
}
