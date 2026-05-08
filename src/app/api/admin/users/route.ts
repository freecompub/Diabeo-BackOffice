/**
 * US-2148 — Admin gestion utilisateurs.
 *
 * GET   → ADMIN — list paginée + filtres (role, status, search)
 *         Cabinet ADMIN (V1+) : scope automatique via HealthcareMember;
 *         super-ADMIN : pas de scope, voit tout.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { userManagementService } from "@/lib/services/user-management.service"
import { logger } from "@/lib/logger"

const roleEnum = z.enum(["ADMIN", "DOCTOR", "NURSE", "VIEWER"])
const statusEnum = z.enum(["active", "suspended", "archived"])

function parseEnumList<T extends string>(
  value: string | null,
  schema: z.ZodType<T>,
): T[] | undefined {
  if (!value) return undefined
  const arr = value.split(",").map((v) => v.trim()).filter(Boolean)
  if (arr.length === 0) return undefined
  const parsed = z.array(schema).safeParse(arr)
  return parsed.success ? parsed.data : undefined
}

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const sp = req.nextUrl.searchParams

    const intSchema = z.coerce.number().int().positive().optional()
    const limitParsed = intSchema.safeParse(sp.get("limit") ?? undefined)
    const cursorParsed = intSchema.safeParse(sp.get("cursor") ?? undefined)
    if (!limitParsed.success || !cursorParsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const result = await userManagementService.list(
      {
        roles: parseEnumList(sp.get("role"), roleEnum),
        statuses: parseEnumList(sp.get("status"), statusEnum),
        search: sp.get("search") ?? undefined,
        // Super-ADMIN sees all (serviceScope = null). Cabinet scoping V1+.
        serviceScope: null,
        limit: limitParsed.data,
        cursor: cursorParsed.data,
      },
      user.id,
      ctx,
    )

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/users GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
