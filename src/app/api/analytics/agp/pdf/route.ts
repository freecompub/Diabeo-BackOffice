/**
 * US-2040 — Rapport AGP PDF cliniquement validé (téléchargement).
 *
 * Compose `glycemicProfile` + `agp` (avec `skipAudit:true` pour éviter la
 * duplication d'audit) puis encode via `generateAgpPdf`. Aucune donnée
 * d'identité (nom, email) n'est intégrée — seul l'ID technique du patient
 * apparaît à l'intérieur du PDF; le nom de fichier utilise un slug opaque.
 *
 * Rate-limit `exportUser` + `exportIp` fail-closed, audit `EXPORT` unique.
 */

import { randomBytes } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { analyticsService } from "@/lib/services/analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditAnalyticsFailure } from "@/lib/audit/analytics-helpers"
import { generateAgpPdf } from "@/lib/pdf/agp-report"

const querySchema = z.object({
  period: z
    .string()
    .regex(/^[1-9]\d{0,1}d$/)
    .refine((s) => parseInt(s, 10) <= 90, { message: "Period max 90 days" })
    .default("14d"),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)

    const rlUser = await checkApiRateLimit(String(user.id), RATE_LIMITS.exportUser)
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
      RATE_LIMITS.exportIp,
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
      await auditAnalyticsFailure({
        user, ctx, resourceId: "agp-pdf", reason: "gdprConsentRequired",
      })
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "agp-pdf", reason: res.error,
        metadata: { kind: "agp-pdf" },
      })
      return NextResponse.json(
        { error: res.error },
        { status: res.error === "invalidPatientId" ? 400 : 404 },
      )
    }
    const patientId = res.patientId

    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    // skipAudit:true — single EXPORT audit row instead of 2 inner READs + EXPORT.
    const [profile, agp] = await Promise.all([
      analyticsService.glycemicProfile(patientId, parsed.data.period, user.id, ctx, { skipAudit: true }),
      analyticsService.agp(patientId, parsed.data.period, user.id, ctx, { skipAudit: true }),
    ])

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
    })

    const slug = randomBytes(6).toString("hex")
    await auditService.log({
      userId: user.id,
      action: "EXPORT",
      resource: "ANALYTICS",
      resourceId: String(patientId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        patientId,
        kind: "agp-pdf",
        slug,
        period: parsed.data.period,
        from: profile.period.from,
        to: profile.period.to,
      },
    })

    const stamp = new Date().toISOString().slice(0, 10)
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
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/agp/pdf]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
