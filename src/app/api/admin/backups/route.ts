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
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
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
  const ctx = extractRequestContext(req)
  try {
    const user = requireRole(req, "ADMIN")

    // A4 — rate-limit per-user 5/h fail-closed (defense ADMIN session
    // compromise spam). Le `backup_already_in_progress` 409 du service
    // bloque déjà N concurrent, mais ne limite pas le RATE de tentatives
    // (chaque échec consomme une count query + un audit log potentiel).
    const userRl = await checkApiRateLimit(String(user.id), RATE_LIMITS.adminBackupTrigger)
    if (!userRl.allowed) {
      // Audit RATE_LIMITED pour forensique SOC (pattern existant US-2002).
      await auditService.log({
        userId: user.id,
        action: "RATE_LIMITED",
        resource: "BACKUP",
        resourceId: "trigger",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { scope: "user", bucket: RATE_LIMITS.adminBackupTrigger.bucket },
      }).catch(() => { /* best-effort */ })
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(userRl.retryAfterSec) } },
      )
    }

    // A4 — rate-limit per-IP 10/h fail-closed (defense cross-session token
    // rotation). Si l'attaquant vole plusieurs sessions ADMIN, le per-user
    // bucket ne le voit pas — le per-IP cap limite l'attaque source.
    const ipRl = await checkApiRateLimit(ctx.ipAddress, RATE_LIMITS.adminBackupTriggerIp)
    if (!ipRl.allowed) {
      await auditService.log({
        userId: user.id,
        action: "RATE_LIMITED",
        resource: "BACKUP",
        resourceId: "trigger",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { scope: "ip", bucket: RATE_LIMITS.adminBackupTriggerIp.bucket },
      }).catch(() => { /* best-effort */ })
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(ipRl.retryAfterSec) } },
      )
    }

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
