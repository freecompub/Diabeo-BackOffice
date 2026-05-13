/** US-2084 — Absence d'un membre du cabinet + couverture. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { memberAbsenceService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

const createSchema = z.object({
  memberId: z.number().int().positive(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  coverMemberId: z.number().int().positive().optional(),
  reason: z.string().max(120).optional(),
})

const querySchema = z.object({ memberId: z.coerce.number().int().positive() })

export async function GET(req: NextRequest) {
  try {
    requireRole(req, "NURSE")
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const items = await memberAbsenceService.listForMember(parsed.data.memberId)
    return NextResponse.json({ items })
  } catch (e) {
    return mapErrorToResponse(e, "team/absences GET")
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const ctx = extractRequestContext(req)
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const row = await memberAbsenceService.create(parsed.data, user.id, ctx)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return mapErrorToResponse(e, "team/absences POST")
  }
}
