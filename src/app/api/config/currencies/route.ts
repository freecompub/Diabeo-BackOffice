/** US-2113 — List + create country currencies. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { countryCurrencyService } from "@/lib/services/country-config.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const listSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  isActive: z.coerce.boolean().optional(),
})

const createSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  symbol: z.string().min(1).max(8),
  exchangeRate: z.number().positive(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = listSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    await auditedRequireRole(req, "NURSE", ctx, "COUNTRY_CURRENCY", "list")
    const items = await countryCurrencyService.list(parsed.data)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "config/currencies GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(req, "ADMIN", ctx, "COUNTRY_CURRENCY", "create")
    const out = await countryCurrencyService.create(parsed.data, user.id, ctx)
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "config/currencies POST", ctx.requestId)
  }
}
