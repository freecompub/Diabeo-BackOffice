/**
 * US-2610 — Capacités / retrait d'un membre de cabinet.
 *  - `PATCH  /api/cabinet/:id/members/:userId` → modifie les capacités Q1/Q2.
 *  - `DELETE /api/cabinet/:id/members/:userId` → retire le membre du service.
 *
 * Autorisation capacité Q2 + règles (principal-only Q2, ADMIN-only isPrincipalAdmin,
 * non-auto-élévation, anti-self-lockout, révocation immédiate) dans le service.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import {
  orgMembershipService,
  OrgMembershipError,
  orgMembershipErrorStatus,
} from "@/lib/services/org-membership.service"
import { extractRequestContext } from "@/lib/services/audit.service"

function parseId(id: string): number | null {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? n : null
}

const capsSchema = z
  .object({
    clinicalRole: z.enum(["DOCTOR", "NURSE"]).nullable().optional(),
    canManage: z.boolean().optional(),
    isPrincipalAdmin: z.boolean().optional(),
  })
  .refine((c) => Object.keys(c).length > 0, { message: "noCapabilityProvided" })

function mapError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof OrgMembershipError) {
    return NextResponse.json({ error: error.code }, { status: orgMembershipErrorStatus(error.code) })
  }
  console.error("[cabinet/members/:userId]", error instanceof Error ? error.message : error)
  return NextResponse.json({ error: "serverError" }, { status: 500 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const user = requireAuth(req)
    const { id, userId } = await params
    const serviceId = parseId(id)
    const targetUserId = parseId(userId)
    if (serviceId === null || targetUserId === null) {
      return NextResponse.json({ error: "invalidId" }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    const parsed = capsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    await orgMembershipService.setCapabilities(
      user.id, user.role, targetUserId, serviceId, parsed.data, extractRequestContext(req),
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    return mapError(error)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const user = requireAuth(req)
    const { id, userId } = await params
    const serviceId = parseId(id)
    const targetUserId = parseId(userId)
    if (serviceId === null || targetUserId === null) {
      return NextResponse.json({ error: "invalidId" }, { status: 400 })
    }

    await orgMembershipService.revokeMember(
      user.id, user.role, targetUserId, serviceId, extractRequestContext(req),
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    return mapError(error)
  }
}
