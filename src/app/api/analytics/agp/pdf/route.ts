/** US-2040 — Rapport AGP PDF (téléchargement). */

import { randomBytes } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth, getAuthUser, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientShareConsent } from "@/lib/consent"
import { analyticsService } from "@/lib/services/analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import {
  auditAnalyticsAccessDenied,
  auditAnalyticsFailure,
} from "@/lib/audit/analytics-helpers"
import { periodSchema } from "@/lib/validators/analytics"
import { generateAgpPdf } from "@/lib/pdf/agp-report"
import { logger } from "@/lib/logger"

const querySchema = periodSchema(90)

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  let user
  try {
    user = requireAuth(req)
  } catch (e) {
    if (e instanceof AuthError) {
      const u = getAuthUser(req)
      if (u && e.status === 403) {
        await auditAnalyticsAccessDenied({ user: u, ctx, resourceId: "agp-pdf" })
      }
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }

  try {
    const rlUser = await checkApiRateLimit(String(user.id), RATE_LIMITS.exportAnalyticsUser)
    if (!rlUser.allowed) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "agp-pdf", reason: "rateLimitExceededUser",
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
        user, ctx, resourceId: "agp-pdf", reason: "rateLimitExceededIp",
        action: "RATE_LIMITED",
      })
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rlIp.retryAfterSec) } },
      )
    }

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      if (res.error === "patientNotFound") {
        await auditAnalyticsAccessDenied({
          user, ctx, resourceId: "agp-pdf", metadata: { reason: res.error },
        })
      }
      return NextResponse.json(
        { error: res.error },
        { status: res.error === "invalidPatientId" ? 400 : 404 },
      )
    }
    const patientId = res.patientId

    const consent = await patientShareConsent(patientId)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error }, { status: consent.status })
    }

    const parsed = querySchema.safeParse(req.nextUrl.searchParams.get("period") ?? undefined)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    // skipAudit:true — single EXPORT audit row instead of 2 inner READs + EXPORT.
    const [profile, agp] = await Promise.all([
      analyticsService.glycemicProfile(patientId, parsed.data, user.id, ctx, { skipAudit: true }),
      analyticsService.agp(patientId, parsed.data, user.id, ctx, { skipAudit: true }),
    ])

    // Refuse to render a PDF when there's no CGM data — clinically meaningless
    // and avoids NaN metrics on the report.
    if (profile.readingCount === 0) {
      return NextResponse.json({ error: "noDataForPeriod" }, { status: 422 })
    }

    const pdf = await generateAgpPdf({
      patientId,
      period: profile.period,
      metrics: {
        averageGlucoseMgdl: profile.metrics.averageGlucoseMgdl,
        gmi: profile.metrics.gmi,
        coefficientOfVariation: profile.metrics.coefficientOfVariation,
      },
      tir: profile.tir,
      captureRate: profile.captureRate,
      readingCount: profile.readingCount,
      agp,
      warning: profile.warning,
    })

    const slug = randomBytes(6).toString("hex")
    try {
      await auditService.log({
        userId: user.id,
        action: "EXPORT",
        resource: "ANALYTICS",
        resourceId: String(patientId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          patientId, kind: "agp-pdf", slug,
          period: parsed.data,
          from: profile.period.from,
          to: profile.period.to,
          warning: profile.warning ?? null,
        },
      })
    } catch (err) {
      logger.error("audit", "agp pdf export audit write failed", {}, err)
    }

    const stamp = new Date().toISOString().slice(0, 10)
    // Copy into a Uint8Array<ArrayBuffer> (not SharedArrayBuffer) so NextResponse's
    // BodyInit type is satisfied. The copy is O(PDF size) ≈ 50-200 KB, negligible.
    const body = new Uint8Array(pdf)
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="agp-${stamp}-${slug}.pdf"`,
        "Cache-Control": "no-store",
        "Content-Length": String(body.byteLength),
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/agp/pdf]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
