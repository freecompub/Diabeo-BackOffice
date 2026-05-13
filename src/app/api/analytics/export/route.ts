/**
 * US-2098 — Export CSV des indicateurs de la population accessible.
 *
 * Format: CSV UTF-8 (BOM pour Excel). Une ligne par patient avec ID technique
 * + métriques agrégées. Aucun champ PII (pas de nom / email / DDN) — la
 * ré-identification nécessite un accès à la base.
 *
 * Sécurité:
 * - Scope NURSE+, scope patient filtré par RBAC + consentement RGPD.
 * - Rate-limit `exportUser` (3/h) + `exportIp` (10/h), tous deux fail-closed.
 * - Audit `EXPORT` sur `ANALYTICS` (resourceId=`population-export-<slug>`)
 *   avec `patientIdsHash` SHA-256 pour permettre la forensique post-hoc.
 * - Toute cellule CSV qui commence par `=+-@\t\r` est préfixée par `'` pour
 *   désamorcer une éventuelle formula injection Excel/LibreOffice.
 */

import { createHash, randomBytes } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { resolveAnalyticsScope } from "@/lib/analytics-scope"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import {
  populationAnalyticsService,
  MAX_WINDOW_DAYS,
} from "@/lib/services/population-analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditAnalyticsFailure } from "@/lib/audit/analytics-helpers"

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(MAX_WINDOW_DAYS).default(14),
})

/**
 * CSV cell escaping with defense-in-depth against formula injection
 * (CVE-2014-3524 family). Any value starting with `=`, `+`, `-`, `@`, tab or
 * CR is prefixed with `'` so Excel/LibreOffice treats it as literal text.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  let str = String(value)
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str
  if (/[",\n\r;]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireRole>> | null = null
  const ctx = extractRequestContext(req)
  try {
    user = requireRole(req, "NURSE")

    const rlUser = await checkApiRateLimit(String(user.id), RATE_LIMITS.exportUser)
    if (!rlUser.allowed) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "population-export", reason: "rateLimitExceededUser",
        action: "RATE_LIMITED",
      })
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rlUser.retryAfterSec) } },
      )
    }
    const rlIp = await checkApiRateLimit(
      `ip:${ctx.ipAddress ?? "unknown-ip"}`,
      RATE_LIMITS.exportIp,
    )
    if (!rlIp.allowed) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "population-export", reason: "rateLimitExceededIp",
        action: "RATE_LIMITED",
      })
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rlIp.retryAfterSec) } },
      )
    }

    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const scope = await resolveAnalyticsScope(user.id, user.role)
    const metrics = await populationAnalyticsService.exportDataset(
      scope, parsed.data.windowDays,
    )

    const slug = randomBytes(6).toString("hex")
    const patientIdsHash = createHash("sha256")
      .update(metrics.map((m) => m.patientId).sort((a, b) => a - b).join(","))
      .digest("hex")

    await auditService.log({
      userId: user.id,
      action: "EXPORT",
      resource: "ANALYTICS",
      resourceId: `population-export-${slug}`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        kind: "population-csv",
        slug,
        patientCount: metrics.length,
        patientIdsHash,
        windowDays: parsed.data.windowDays,
      },
    })

    const headers = [
      "patientId",
      "pathology",
      "readingCount",
      "captureRate",
      "averageGlucoseMgdl",
      "gmi",
      "coefficientOfVariation",
      "tirInRange",
      "tirSevereHypo",
      "activeLast24h",
    ]
    const rows = metrics.map((m) =>
      [
        m.patientId,
        m.pathology,
        m.readingCount,
        m.captureRate,
        m.averageGlucoseMgdl,
        m.gmi,
        m.coefficientOfVariation,
        m.tir?.inRange ?? null,
        m.tir?.severeHypo ?? null,
        m.activeLast24h ? 1 : 0,
      ].map(csvCell).join(","),
    )
    const body = "﻿" + [headers.join(","), ...rows].join("\r\n") + "\r\n"

    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="diabeo-analytics-${stamp}-${slug}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    if (msg.startsWith("populationTooLarge") && user) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "population-export", reason: "populationTooLarge",
      })
      return NextResponse.json({ error: "populationTooLarge" }, { status: 413 })
    }
    console.error("[analytics/export]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
