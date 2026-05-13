/**
 * US-2098 — Export CSV des indicateurs de la population accessible.
 *
 * Format: CSV UTF-8 (BOM Excel). Aucun champ PII. Rate-limit fail-closed
 * dédié à l'export analytics (distinct du bucket export RGPD compte) +
 * audit `EXPORT` avec `patientIdsHash` SHA-256 (jeu de patients + fenêtre).
 */

import { createHash, randomBytes } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { requireRole, getAuthUser, AuthError } from "@/lib/auth"
import { resolveAnalyticsScope } from "@/lib/analytics-scope"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import {
  populationAnalyticsService,
  PopulationTooLargeError,
  MAX_WINDOW_DAYS,
} from "@/lib/services/population-analytics.service"
import { windowDaysSchema } from "@/lib/validators/analytics"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import {
  auditAnalyticsAccessDenied,
  auditAnalyticsFailure,
} from "@/lib/audit/analytics-helpers"
import { csvCell } from "@/lib/csv/cell"
import { logger } from "@/lib/logger"

const querySchema = windowDaysSchema(MAX_WINDOW_DAYS)

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  let user
  try {
    user = requireRole(req, "NURSE")
  } catch (e) {
    if (e instanceof AuthError) {
      const u = getAuthUser(req)
      if (u && e.status === 403) {
        await auditAnalyticsAccessDenied({
          user: u, ctx, resourceId: "population-export",
        })
      }
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }

  try {
    const rlUser = await checkApiRateLimit(String(user.id), RATE_LIMITS.exportAnalyticsUser)
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
      RATE_LIMITS.exportAnalyticsIp,
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

    const parsed = querySchema.safeParse(req.nextUrl.searchParams.get("windowDays") ?? undefined)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const scope = await resolveAnalyticsScope(user.id, user.role)
    const metrics = await populationAnalyticsService.exportDataset(scope, parsed.data)

    const slug = randomBytes(6).toString("hex")
    // Hash includes windowDays so two exports with the same patient set but
    // different windows produce distinct fingerprints.
    const patientIdsHash = createHash("sha256")
      .update(`days=${parsed.data}|`)
      .update(metrics.map((m) => m.patientId).sort((a, b) => a - b).join(","))
      .digest("hex")

    // Audit-write failure on the success path must NOT crash the response —
    // the work is already done and the user shouldn't be re-debited on a
    // transient DB blip. We swallow but log via the structured logger.
    try {
      await auditService.log({
        userId: user.id,
        action: "EXPORT",
        resource: "ANALYTICS",
        resourceId: `population-export-${slug}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          kind: "population-csv",
          slug,
          patientCount: metrics.length,
          patientIdsHash,
          windowDays: parsed.data,
        },
      })
    } catch (err) {
      logger.error("audit", "analytics export audit write failed", {}, err)
    }

    const headers = [
      "patientId", "pathology", "readingCount", "captureRate",
      "averageGlucoseMgdl", "gmi", "coefficientOfVariation",
      "tirInRange", "tirSevereHypo", "activeLast24h",
    ]
    const rows = metrics.map((m) =>
      [
        m.patientId, m.pathology, m.readingCount, m.captureRate,
        m.averageGlucoseMgdl, m.gmi, m.coefficientOfVariation,
        m.tir?.inRange ?? null, m.tir?.severeHypo ?? null,
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
    if (error instanceof PopulationTooLargeError) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "population-export", reason: "populationTooLarge",
        action: "RATE_LIMITED",
        metadata: { observed: error.observed, cap: error.cap },
      })
      return NextResponse.json({ error: "populationTooLarge" }, { status: 413 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/export]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
