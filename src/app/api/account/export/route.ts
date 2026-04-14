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
    const [rlUser, rlIp] = await Promise.all([
      checkApiRateLimit(String(user.id), RATE_LIMITS.exportUser),
      checkApiRateLimit(`ip:${ctx.ipAddress ?? "unknown"}`, RATE_LIMITS.exportIp),
    ])
    const blocked = !rlUser.allowed ? rlUser : !rlIp.allowed ? rlIp : null
    if (blocked) {
      await auditService.log({
        userId: user.id,
        action: "UNAUTHORIZED",
        resource: "USER",
        resourceId: String(user.id),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          reason: "rateLimitExceeded",
          endpoint: "account/export",
          bucket: !rlUser.allowed ? "user" : "ip",
          degraded: blocked.degraded ?? false,
        },
      })
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(blocked.retryAfterSec) } },
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
