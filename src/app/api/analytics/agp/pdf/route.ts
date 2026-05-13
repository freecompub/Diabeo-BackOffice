/**
 * US-2040 — Rapport AGP PDF cliniquement validé (téléchargement).
 *
 * Compose `glycemicProfile` + `agp` puis encode le tout via `generateAgpPdf`.
 * Aucune donnée d'identité (nom, email) n'est intégrée — seul l'ID technique
 * du patient apparaît. Rate-limit `exportUser` + audit `EXPORT`.
 */

import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { analyticsService } from "@/lib/services/analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { generateAgpPdf } from "@/lib/pdf/agp-report"

const querySchema = z.object({
  period: z
    .string()
    .regex(/^[1-9]\d{0,1}d$/)
    .refine((s) => parseInt(s, 10) <= 90, { message: "Period max 90 days" })
    .default("14d"),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const ctx = extractRequestContext(req)

    const rlUser = await checkApiRateLimit(String(user.id), RATE_LIMITS.exportUser)
    if (!rlUser.allowed) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rlUser.retryAfterSec) } },
      )
    }

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
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

    const [profile, agp] = await Promise.all([
      analyticsService.glycemicProfile(patientId, parsed.data.period, user.id, ctx),
      analyticsService.agp(patientId, parsed.data.period, user.id, ctx),
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

    await auditService.log({
      userId: user.id,
      action: "EXPORT",
      resource: "ANALYTICS",
      resourceId: String(patientId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { patientId, kind: "agp-pdf", period: parsed.data.period },
    })

    const stamp = new Date().toISOString().slice(0, 10)
    const body = new Uint8Array(pdf)
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="agp-patient-${patientId}-${stamp}.pdf"`,
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
