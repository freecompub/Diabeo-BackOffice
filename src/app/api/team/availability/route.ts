/** US-2504 — Member unavailability slots (list + create). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { memberUnavailabilityService } from "@/lib/services/rdv.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const listSchema = z.object({
  memberId: z.coerce.number().int().positive(),
  from: z.coerce.date(),
  to: z.coerce.date(),
})
const createSchema = z.object({
  memberId: z.number().int().positive(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  reason: z.string().max(200).optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = listSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(req, "NURSE", ctx, "MEMBER_UNAVAILABILITY", String(parsed.data.memberId))
    const items = await memberUnavailabilityService.listForMember(
      parsed.data.memberId, { from: parsed.data.from, to: parsed.data.to }, user.id, ctx,
    )
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/availability GET", ctx.requestId)
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
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "MEMBER_UNAVAILABILITY", String(parsed.data.memberId))
    const row = await memberUnavailabilityService.create(parsed.data, user.id, ctx)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/availability POST", ctx.requestId)
  }
}
