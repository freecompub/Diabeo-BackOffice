/**
 * US-2057 — Meal photos.
 *
 * Review PR #391 :
 *  - L3 : Content-Length short-circuit (avoid buffering 5 MB before reject).
 *  - M5 : `analytics` rate-limit (fail-open) on POST — anti-DoS ClamAV.
 *  - L2 : width/height NOT accepted from form data anymore (computed by `sharp`).
 *  - C2/C3 : EXIF strip + TOCTOU fix handled service-side.
 *  - M13 : `s3Key` not returned (service returns `MealPhotoPublicDTO`).
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { mealPhotoService } from "@/lib/services/insulin-meals.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { prisma } from "@/lib/db/client"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import { ValidationError } from "@/lib/services/team-workflow.errors"

type RouteParams = { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHOTO_MAX_BYTES = 5 * 1024 * 1024

async function ensurePatientAlive(id: number): Promise<boolean> {
  const p = await prisma.patient.findFirst({
    where: { id, deletedAt: null }, select: { id: true },
  })
  return !!p
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const user = await auditedRequireRole(req, "NURSE", ctx, "MEAL_PHOTO", String(patientId))

    if (!(await ensurePatientAlive(patientId))) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "MEAL_PHOTO", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const items = await mealPhotoService.listForPatient(patientId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/:id/meal-photos GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const user = await auditedRequireRole(req, "NURSE", ctx, "MEAL_PHOTO", String(patientId))

    // M5 — rate-limit photo uploads (fail-open analytics bucket — UX over guard).
    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.analytics)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      )
    }

    // L3 — short-circuit before buffering large bodies.
    const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10)
    if (contentLength > PHOTO_MAX_BYTES + 2048 /* small overhead for multipart */) {
      return NextResponse.json({ error: "sizeBytes", field: "sizeBytes" }, { status: 413 })
    }

    if (!(await ensurePatientAlive(patientId))) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "MEAL_PHOTO", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "upload" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const formData = await req.formData().catch(() => null)
    if (!formData) return NextResponse.json({ error: "invalidMultipart" }, { status: 400 })
    const eventId = formData.get("eventId")
    const file = formData.get("photo")
    if (typeof eventId !== "string" || !UUID_RE.test(eventId)) {
      return NextResponse.json({ error: "invalidEventId" }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missingPhoto" }, { status: 400 })
    }
    if (file.size > PHOTO_MAX_BYTES) {
      return NextResponse.json({ error: "sizeBytes", field: "sizeBytes" }, { status: 413 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())

    try {
      // Width/height computed by sharp during EXIF strip — not trusted from client.
      const out = await mealPhotoService.upload(
        { eventId, patientId, buffer, mimeType: file.type },
        user.id, ctx,
      )
      return NextResponse.json(out, { status: 201 })
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json({ error: e.message, field: e.field }, { status: 422 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/:id/meal-photos POST", ctx.requestId)
  }
}
