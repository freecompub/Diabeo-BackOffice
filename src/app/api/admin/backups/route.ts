/**
 * US-2151 — Admin gestion backups PostgreSQL.
 *
 * GET   → ADMIN — list paginée + filtres status / from / to
 * POST  → ADMIN — déclenche un nouveau backup (statut `pending`)
 *
 * Le worker externe (cron / process séparé) consomme les rows `pending` et
 * met à jour le statut via `backupService.updateStatus` (non exposé en HTTP).
 *
 * **A4 round 2** — 43 findings résolus :
 *   - C-1 : `ctx.ipAddress === "unknown"` → composite `unknown:<userId>`
 *     (anti collapse cross-user) + logger.warn signal reverse proxy.
 *   - C-2 : `auditService.rateLimited()` câble US-2265 burst detection.
 *   - C-3 : caps 3/h user + 6/h IP (alignés sensibilité full-PHI dump).
 *   - C-4 : `degraded` propagé en `metadata.degraded` (SOC peut trier
 *     "infra incident" vs "attaque").
 *   - H-1 : Les 2 checks (user + IP) s'exécutent INCONDITIONNELLEMENT.
 *     L'audit IP-scoped reste précis même si user-cap déjà dépassé.
 *   - H-2 : `.catch` audit → `logger.warn` (visibilité forensique).
 *   - H-5 : `Retry-After: Math.max(1, retryAfterSec)`.
 *   - M-1 : Headers ANSSI sur 429 (no-store + nosniff + Referrer-Policy).
 *   - M-2 : Headers `X-RateLimit-*` sur 202 succès (RFC 6585).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import {
  checkApiRateLimit,
  RATE_LIMITS,
  type ApiRateLimitResult,
} from "@/lib/auth/api-rate-limit"
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

/**
 * A4 round 2 M-1 — Headers ANSSI RGS §4.5 sur les responses 429.
 * Empêche cache proxy d'exposer Retry-After (timing oracle indirect).
 */
const ANSSI_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
}

/**
 * A4 round 2 M-2 — Headers `X-RateLimit-*` (RFC 6585 / draft-ietf-httpapi-
 * ratelimit-headers) pour UI countdown "X backups left this hour".
 */
function rateLimitHeaders(
  userRl: ApiRateLimitResult,
  ipRl: ApiRateLimitResult,
): Record<string, string> {
  const minRemaining = Math.min(userRl.remaining, ipRl.remaining)
  const maxRetryAfter = Math.max(userRl.retryAfterSec, ipRl.retryAfterSec)
  return {
    "X-RateLimit-Limit-User": String(RATE_LIMITS.adminBackupTrigger.max),
    "X-RateLimit-Limit-Ip": String(RATE_LIMITS.adminBackupTriggerIp.max),
    "X-RateLimit-Remaining": String(Math.max(0, minRemaining)),
    "X-RateLimit-Reset": String(maxRetryAfter),
  }
}

/**
 * A4 round 2 C-1 — Si `ipAddress === "unknown"` (reverse proxy mal
 * configuré OU direct connect), DEGRADE en composite `unknown:<userId>`
 * pour empêcher TOUS les ADMIN anonymes de partager le même bucket
 * (collapse → DoS interne accidentel + signal forensique corrompu).
 *
 * Le composite garde la sémantique "per-IP" effective au niveau user,
 * mais sans cross-user collision. Émet `logger.warn` pour ops.
 */
function resolveIpIdentifier(ipAddress: string, userId: number): string {
  if (ipAddress === "unknown") {
    logger.warn("api", "admin/backups: ipAddress=unknown — composite IP bucket fallback", {
      kind: "rate-limit.ip.unknown",
      userId,
    })
    return `unknown:${userId}`
  }
  return ipAddress
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireRole(req, "ADMIN")

    // C-1 — composite IP identifier si "unknown".
    const ipIdentifier = resolveIpIdentifier(ctx.ipAddress, user.id)

    // H-1 — les 2 checks s'exécutent INCONDITIONNELLEMENT (les compteurs
    // Redis sont incrémentés en parallèle). L'audit IP-scoped reste précis
    // même si user-cap déjà dépassé.
    const [userRl, ipRl] = await Promise.all([
      checkApiRateLimit(String(user.id), RATE_LIMITS.adminBackupTrigger),
      checkApiRateLimit(ipIdentifier, RATE_LIMITS.adminBackupTriggerIp),
    ])

    // Si l'un OU l'autre fail → 429. Audit les 2 scopes failed avec
    // metadata.degraded propagé (C-4 — SOC peut trier infra vs attaque).
    if (!userRl.allowed || !ipRl.allowed) {
      // Audit per-user si user fail (with burst US-2265 via C-2).
      if (!userRl.allowed) {
        await emitRateLimitedAudit(user.id, ctx, "user", userRl, RATE_LIMITS.adminBackupTrigger.bucket)
      }
      // Audit per-IP si IP fail (indépendant du user).
      if (!ipRl.allowed) {
        await emitRateLimitedAudit(user.id, ctx, "ip", ipRl, RATE_LIMITS.adminBackupTriggerIp.bucket)
      }

      // H-5 — Retry-After ≥ 1 (jamais 0 ni négatif).
      const failed = !userRl.allowed ? userRl : ipRl
      const retryAfter = Math.max(1, failed.retryAfterSec)

      return NextResponse.json(
        { error: "rateLimitExceeded" },
        {
          status: 429,
          headers: {
            ...ANSSI_HEADERS,
            "Retry-After": String(retryAfter),
            ...rateLimitHeaders(userRl, ipRl),
          },
        },
      )
    }

    try {
      const created = await backupService.trigger(user.id, ctx)
      // M-2 — Headers X-RateLimit-* sur succès pour UI countdown.
      return NextResponse.json(created, {
        status: 202,
        headers: rateLimitHeaders(userRl, ipRl),
      })
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
    logger.error("api", "admin/backups POST failed", { requestId: ctx.requestId }, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/**
 * A4 round 2 C-2 + C-4 + H-2 — Audit RATE_LIMITED via `auditService.rateLimited`
 * (câble burst US-2265). `logger.warn` sur fail au lieu de catch silent.
 */
async function emitRateLimitedAudit(
  userId: number,
  ctx: { ipAddress: string; userAgent: string; requestId: string },
  scope: "user" | "ip",
  rl: ApiRateLimitResult,
  bucket: string,
): Promise<void> {
  try {
    await auditService.rateLimited({
      userId,
      resource: "BACKUP",
      resourceId: "trigger",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        scope,
        bucket,
        // C-4 — degraded flag pour distinguer Redis outage vs attaque réelle.
        degraded: rl.degraded ?? false,
        retryAfterSec: rl.retryAfterSec,
      },
    })
  } catch (err) {
    // H-2 — logger.warn au lieu de catch silent (visibilité forensique).
    logger.warn("api", "audit RATE_LIMITED persist failed", {
      kind: "audit.rate_limited.persist_failed",
      userId,
      requestId: ctx.requestId,
      failMode: err instanceof Error ? err.message : String(err),
    })
  }
}
