/**
 * US-2098 — Export CSV des indicateurs de la population accessible.
 *
 * Format: CSV UTF-8 (BOM pour Excel). Une ligne par patient avec ID technique
 * + métriques agrégées sur la fenêtre. Aucun champ PII (pas de nom / email /
 * date de naissance) — la ré-identification nécessite un accès à la base.
 *
 * Sécurité:
 * - Scope NURSE+ (la portée patient est filtrée par RBAC via
 *   `getAccessiblePatientIds`).
 * - Rate-limit `exportUser` (3/h, fail-closed) — garde anti-exfiltration HDS.
 * - Audit `EXPORT` sur `ANALYTICS` (resourceId=`population-export`).
 */

import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { resolveAnalyticsPatientIds } from "@/lib/analytics-scope"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { populationAnalyticsService } from "@/lib/services/population-analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(30).default(14),
})

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  const str = String(value)
  if (/[",\n\r;]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const ctx = extractRequestContext(req)

    const rlUser = await checkApiRateLimit(String(user.id), RATE_LIMITS.exportUser)
    if (!rlUser.allowed) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rlUser.retryAfterSec) } },
      )
    }
    const rlIp = await checkApiRateLimit(ctx.ipAddress ?? "unknown-ip", RATE_LIMITS.exportIp)
    if (!rlIp.allowed) {
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

    const patientIds = await resolveAnalyticsPatientIds(user.id, user.role)
    const metrics = await populationAnalyticsService.exportDataset(
      patientIds,
      parsed.data.windowDays,
    )

    await auditService.log({
      userId: user.id,
      action: "EXPORT",
      resource: "ANALYTICS",
      resourceId: "population-export",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        kind: "population-csv",
        patientCount: metrics.length,
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
        "Content-Disposition": `attachment; filename="population-analytics-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/export]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
