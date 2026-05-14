/** US-2114 — List + create country tax rules. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { countryTaxRuleService } from "@/lib/services/country-config.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const TAX_TYPES = ["VAT", "INCOME_TAX", "CORPORATE_TAX", "SOCIAL_CONTRIBUTION"] as const

const listSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  taxType: z.enum(TAX_TYPES).optional(),
  isActive: z.coerce.boolean().optional(),
})

const createSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  taxType: z.enum(TAX_TYPES),
  baseRate: z.number().min(0).max(1),
  description: z.string().max(500).optional(),
  appliesFrom: z.coerce.date(),
  appliesUntil: z.coerce.date().nullable().optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = listSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    await auditedRequireRole(req, "NURSE", ctx, "COUNTRY_TAX_RULE", "list")
    const items = await countryTaxRuleService.list(parsed.data)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "config/tax-rules GET", ctx.requestId)
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
    const user = await auditedRequireRole(req, "ADMIN", ctx, "COUNTRY_TAX_RULE", "create")
    const out = await countryTaxRuleService.create(parsed.data, user.id, ctx)
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "config/tax-rules POST", ctx.requestId)
  }
}
