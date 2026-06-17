/**
 * US-2610 — Gestion des membres d'un cabinet (service).
 *  - `GET  /api/cabinet/:id/members`  → liste (gated Q2 serveur).
 *  - `POST /api/cabinet/:id/members`  → invite/rattache un membre.
 *
 * L'autorisation **capacité Q2** (canManage / principal-admin) est vérifiée dans
 * le service (`orgMembershipService`, ADMIN bypass V1). La route ne fait que
 * authentifier + valider (Zod) + mapper les erreurs.
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
import { logger } from "@/lib/logger"

function parseServiceId(id: string): number | null {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? n : null
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  clinicalRole: z.enum(["DOCTOR", "NURSE"]).optional(),
  canManage: z.boolean().optional(),
  isPrincipalAdmin: z.boolean().optional(),
})

function mapError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof OrgMembershipError) {
    return NextResponse.json({ error: error.code }, { status: orgMembershipErrorStatus(error.code) })
  }
  logger.error("api/cabinet/members", "request failed", {}, error)
  return NextResponse.json({ error: "serverError" }, { status: 500 })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireAuth(req)
    const serviceId = parseServiceId((await params).id)
    if (serviceId === null) return NextResponse.json({ error: "invalidId" }, { status: 400 })

    const members = await orgMembershipService.listMembers(
      user.id, user.role, serviceId, extractRequestContext(req),
    )
    return NextResponse.json({ members })
  } catch (error) {
    return mapError(error)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = requireAuth(req)
    const serviceId = parseServiceId((await params).id)
    if (serviceId === null) return NextResponse.json({ error: "invalidId" }, { status: 400 })

    const body = await req.json().catch(() => null)
    const parsed = inviteSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    await orgMembershipService.inviteMember(
      user.id, user.role, serviceId, parsed.data, extractRequestContext(req),
    )
    // Réponse NEUTRE (anti-énumération, HSA MEDIUM) : ne pas révéler si l'email
    // existait déjà (invitedNewUser) ni l'userId cible. L'UI re-fetch la liste.
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    return mapError(error)
  }
}
