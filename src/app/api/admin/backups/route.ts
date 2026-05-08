/**
 * US-2151 — Admin gestion backups PostgreSQL.
 *
 * GET   → ADMIN — list paginée + filtres status / from / to
 * POST  → ADMIN — déclenche un nouveau backup (statut `pending`)
 *
 * Le worker externe (cron / process séparé) consomme les rows `pending` et
 * met à jour le statut via `backupService.updateStatus` (non exposé en HTTP).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { backupService } from "@/lib/services/backup.service"
import { logger } from "@/lib/logger"

const statusEnum = z.enum(["pending", "running", "completed", "failed"])

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
    const dateSchema = z.coerce.date().optional()
    const limitParsed = intSchema.safeParse(sp.get("limit") ?? undefined)
    const cursorParsed = intSchema.safeParse(sp.get("cursor") ?? undefined)
    const fromParsed = dateSchema.safeParse(sp.get("from") ?? undefined)
    const toParsed = dateSchema.safeParse(sp.get("to") ?? undefined)
    if (
      !limitParsed.success ||
      !cursorParsed.success ||
      !fromParsed.success ||
      !toParsed.success
    ) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const result = await backupService.list(
      {
        status: parseEnumList(sp.get("status"), statusEnum),
        from: fromParsed.data,
        to: toParsed.data,
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
    logger.error("api", "admin/backups GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const POST_USER_ERROR_CODES = new Map<string, number>([
  ["backup_already_in_progress", 409],
])

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const ctx = extractRequestContext(req)
    try {
      const created = await backupService.trigger(user.id, ctx)
      return NextResponse.json(created, { status: 202 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "serverError"
      const status = POST_USER_ERROR_CODES.get(msg)
      if (status) {
        return NextResponse.json({ error: msg }, { status })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/backups POST failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
