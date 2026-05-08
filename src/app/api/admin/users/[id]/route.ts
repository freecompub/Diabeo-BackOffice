/**
 * US-2148 — Admin gestion utilisateur (détail + opérations).
 *
 * GET    → ADMIN — détail user (PII déchiffrée)
 * PATCH  → ADMIN — update role OU status (transitions audit)
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { userManagementService } from "@/lib/services/user-management.service"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: Promise<{ id: string }>
}

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "ADMIN")
    const { id: rawId } = await params
    const id = parseId(rawId)
    if (id === null) {
      return NextResponse.json({ error: "invalidUserId" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const target = await userManagementService.getById(id, user.id, ctx)
    if (!target) {
      return NextResponse.json({ error: "userNotFound" }, { status: 404 })
    }
    return NextResponse.json(target)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/users/[id] GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/**
 * PATCH n'accepte qu'UN champ à la fois (role XOR status). Sinon les deux
 * mutations seraient des transactions séparées : un `role` qui réussirait
 * suivi d'un `status` qui échoue laisserait la base partiellement modifiée
 * sans rollback du `role`.
 */
const patchSchema = z
  .object({
    role: z.enum(["ADMIN", "DOCTOR", "NURSE", "VIEWER"]).optional(),
    status: z.enum(["active", "suspended", "archived"]).optional(),
  })
  .refine(
    (d) => (d.role !== undefined ? 1 : 0) + (d.status !== undefined ? 1 : 0) === 1,
    { message: "Exactly one of `role` or `status` must be provided" },
  )

const USER_ERROR_CODES = new Map<string, number>([
  ["user_not_found", 404],
  ["last_admin_cannot_be_demoted", 409],
  ["last_active_admin_cannot_be_suspended", 409],
  ["cannot_change_own_status", 403],
  ["cannot_demote_self", 403],
])

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "ADMIN")
    const { id: rawId } = await params
    const id = parseId(rawId)
    if (id === null) {
      return NextResponse.json({ error: "invalidUserId" }, { status: 400 })
    }

    const body = await req.json()
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    try {
      // Type guard explicite : la `.refine` garantit qu'exactement UN champ
      // est défini, mais TS ne narrow pas. Branche switch lisible et sans `!`.
      let result
      if (parsed.data.role !== undefined) {
        result = await userManagementService.updateRole(id, parsed.data.role, user.id, ctx)
      } else if (parsed.data.status !== undefined) {
        result = await userManagementService.setStatus(id, parsed.data.status, user.id, ctx)
      } else {
        // Unreachable per Zod refine, but defensively explicit.
        return NextResponse.json({ error: "validationFailed" }, { status: 400 })
      }
      return NextResponse.json(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "serverError"
      const status = USER_ERROR_CODES.get(msg)
      if (status) {
        return NextResponse.json({ error: msg }, { status })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/users/[id] PATCH failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
