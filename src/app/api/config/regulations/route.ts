/** US-2116 — List + create healthcare regulations per country. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { healthcareRegulationService } from "@/lib/services/country-config.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const REG_TYPES = [
  "RPPS", "ADELI", "INS", "HDS", "RGPD", "MSSANTE", "FINESS", "OTHER",
] as const

const listSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  regulationType: z.enum(REG_TYPES).optional(),
  isActive: z.coerce.boolean().optional(),
})

const createSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  regulationType: z.enum(REG_TYPES),
  title: z.string().min(1).max(200),
  rule: z.string().min(1).max(50_000),
  references: z.string().max(10_000).optional(),
  enforcedFrom: z.coerce.date(),
  enforcedUntil: z.coerce.date().nullable().optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = listSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    await auditedRequireRole(req, "NURSE", ctx, "HEALTHCARE_REGULATION", "list")
    const items = await healthcareRegulationService.list(parsed.data)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "config/regulations GET", ctx.requestId)
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
    const user = await auditedRequireRole(req, "ADMIN", ctx, "HEALTHCARE_REGULATION", "create")
    const out = await healthcareRegulationService.create(parsed.data, user.id, ctx)
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "config/regulations POST", ctx.requestId)
  }
}
