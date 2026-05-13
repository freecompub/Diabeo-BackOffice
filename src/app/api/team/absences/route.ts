/** US-2084 — Absence membre cabinet (review PR #390 H1, H7, L3). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { memberAbsenceService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const createSchema = z.object({
  memberId: z.number().int().positive(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  coverMemberId: z.number().int().positive().optional(),
  reason: z.string().max(120).optional(),
})

const querySchema = z.object({ memberId: z.coerce.number().int().positive() })

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(req, "NURSE", ctx, "MEMBER_ABSENCE", String(parsed.data.memberId))
    // H7 — service-side membership check + audit happens inside listForMember.
    const items = await memberAbsenceService.listForMember(parsed.data.memberId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/absences GET", ctx.requestId)
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
    const user = await auditedRequireRole(req, "ADMIN", ctx, "MEMBER_ABSENCE", String(parsed.data.memberId))
    const row = await memberAbsenceService.create(parsed.data, user.id, ctx)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/absences POST", ctx.requestId)
  }
}
