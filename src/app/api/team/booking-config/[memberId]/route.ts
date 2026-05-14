/** US-2505 — Member booking config (auto vs validation). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { BookingMode } from "@prisma/client"
import { AuthError } from "@/lib/auth"
import {
  memberBookingConfigService,
  assertMemberServiceAccess,
  type MemberBookingConfigUpdateInput,
} from "@/lib/services/rdv.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ memberId: string }> }

const updateSchema = z.object({
  bookingMode: z.enum(BookingMode).optional(),
  defaultAppointmentMinutes: z.number().int().min(15).max(240).nullable().optional(),
})

export async function GET(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { memberId } = await params
    if (!/^\d+$/.test(memberId)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "NURSE", ctx, "MEMBER_BOOKING_CONFIG", memberId)
    const mid = parseInt(memberId, 10)
    try {
      // H11 — same-service access required before any read.
      await assertMemberServiceAccess(user.id, mid)
    } catch (err) {
      return mapErrorToResponse(err, "team/booking-config GET", ctx.requestId, {
        user, ctx, resource: "MEMBER_BOOKING_CONFIG", resourceId: memberId,
        metadata: { memberId: mid, endpoint: "get" },
      })
    }
    const cfg = await memberBookingConfigService.get(mid)
    if (!cfg) return NextResponse.json({ error: "notFound" }, { status: 404 })
    return NextResponse.json(cfg)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/booking-config GET", ctx.requestId)
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { memberId } = await params
    if (!/^\d+$/.test(memberId)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "MEMBER_BOOKING_CONFIG", memberId)
    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    // H1 — preserve `null` (clear) vs `undefined` (no-op) through the call chain.
    const input: MemberBookingConfigUpdateInput = {}
    if (parsed.data.bookingMode !== undefined) input.bookingMode = parsed.data.bookingMode
    if (parsed.data.defaultAppointmentMinutes !== undefined) {
      input.defaultAppointmentMinutes = parsed.data.defaultAppointmentMinutes
    }
    const out = await memberBookingConfigService.update(
      parseInt(memberId, 10), input, user.id, ctx,
    )
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/booking-config PUT", ctx.requestId)
  }
}
