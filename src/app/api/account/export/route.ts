import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { generateUserExport } from "@/lib/services/export.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const ctx = extractRequestContext(req)

    // Fail-closed: an RGPD export exfiltrates the full health dataset (Art. 20).
    // Redis outage + permissive policy would turn this into an unbounded channel.
    // Check user bucket FIRST (short-circuit): if blocked, we must not burn the
    // IP quota, and vice versa — otherwise a legitimate user on a busy shared
    // IP would exhaust their 3/h budget without ever completing an export.
    const rlUser = await checkApiRateLimit(String(user.id), RATE_LIMITS.exportUser)
    const rlIp = rlUser.allowed
      ? await checkApiRateLimit(`ip:${ctx.ipAddress ?? "unknown"}`, RATE_LIMITS.exportIp)
      : null
    const blocked = !rlUser.allowed ? rlUser : rlIp && !rlIp.allowed ? rlIp : null
    if (blocked) {
      // Skip the audit DB write when the block is a degraded fail-closed fallback:
      // during a Redis outage, compounding with a Postgres write storm hurts more
      // than it helps. The console.error in api-rate-limit already traces the event.
      if (!blocked.degraded) {
        await auditService.log({
          userId: user.id,
          action: "RATE_LIMITED",
          resource: "USER",
          resourceId: String(user.id),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: {
            endpoint: "account/export",
            bucket: !rlUser.allowed ? "user" : "ip",
          },
        })
      }
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        {
          status: 429,
          headers: {
            "Retry-After": String(blocked.retryAfterSec),
            "X-RateLimit-Limit": String(
              !rlUser.allowed ? RATE_LIMITS.exportUser.max : RATE_LIMITS.exportIp.max,
            ),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + blocked.retryAfterSec),
          },
        },
      )
    }

    const exportData = await generateUserExport(user.id)

    if (!exportData) {
      return NextResponse.json({ error: "userNotFound" }, { status: 404 })
    }

    const json = JSON.stringify(exportData, null, 2)
    const sizeBytes = Buffer.byteLength(json, "utf8")

    await auditService.log({
      userId: user.id,
      action: "EXPORT",
      resource: "USER",
      resourceId: String(user.id),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { format: "json", sizeBytes },
    })

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="diabeo-export-${user.id}-${Date.now()}.json"`,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/export GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
