/**
 * Groupe 10 Batch C — Modes spéciaux (US-2233/2234/2235).
 * Dynamic dispatch by `type` ∈ { pediatric, ramadan, travel }.
 *
 * GET — read active mode for patient (VIEWER+ on own patient ; NURSE+ on
 *       managed patient via `canAccessPatient`).
 * PUT — upsert new version (NURSE+, requires DOCTOR `validate` to go live).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { MODE_TYPES, type ModeTypeParam } from "@/lib/patient-modes-shared"
import {
  pediatricModeService,
  ramadanModeService,
  travelModeService,
} from "@/lib/services/patient-modes.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

// Zod schemas — one per mode.
const pediatricUpsertSchema = z.object({
  caregivers: z.array(z.object({
    rank: z.number().int().min(1).max(5),
    name: z.string().min(1).max(100),
    phone: z.string().min(1).max(20),
    relationship: z.string().min(1).max(50),
    permissionLevel: z.enum(["read", "write", "propose"]),
  })).min(1).max(5),
})

const ramadanUpsertSchema = z.object({
  ramadanYear: z.number().int().min(2024).max(2050),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sahurTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  iftarTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  allowedFastingHours: z.number().int().min(1).max(20),
  isfMultiplier: z.number().min(0.5).max(2.0),
  icrMultiplier: z.number().min(0.5).max(2.0),
})

// H1 (re-review C, post-merge) — Zod bounds must match service constants
//   (medical M1+M2) : basalMultiplier ∈ [0.7, 1.3] (ATTD/EASD 2022 ±30%),
//   basalDelayHours ∈ [0, 12]. Without this, the route returns a 400 with
//   shape `{ error, details }` while the service returns `{ error, field }`
//   — clients branch on shape.
const travelUpsertSchema = z.object({
  destination: z.string().min(1).max(100),
  timezoneOffsetHours: z.number().min(-12).max(14),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  basalMultiplier: z.number().min(0.7).max(1.3),
  basalDelayHours: z.number().int().min(0).max(12),
})

type RouteCtx = { params: Promise<{ type: string }> }

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const { type } = await params
  const ctx = extractRequestContext(req)
  try {
    if (!MODE_TYPES.includes(type as ModeTypeParam)) {
      return NextResponse.json({ error: "unsupportedModeType" }, { status: 400 })
    }
    const user = await auditedRequireRole(req, "VIEWER", ctx, "PATIENT_MODE", "0")
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      return NextResponse.json({ error: res.error }, {
        status: res.error === "invalidPatientId" ? 400 : 404,
      })
    }
    const allowed = await canAccessPatient(user.id, user.role, res.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT_MODE", resourceId: String(res.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: res.patientId, mode: type, endpoint: "get" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    // GDPR consent required — PHI decrypt (pediatric) and clinical config reads.
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    switch (type as ModeTypeParam) {
      case "pediatric": {
        const out = await pediatricModeService.getActive(res.patientId, user.id, ctx)
        return NextResponse.json(out)
      }
      case "ramadan": {
        const out = await ramadanModeService.getActive(res.patientId, user.id, ctx)
        return NextResponse.json(out)
      }
      case "travel": {
        const out = await travelModeService.getActive(res.patientId, user.id, ctx)
        return NextResponse.json(out)
      }
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, `patient/modes/${type} GET`, ctx.requestId)
  }
}

export async function PUT(req: NextRequest, { params }: RouteCtx) {
  const { type } = await params
  const ctx = extractRequestContext(req)
  try {
    if (!MODE_TYPES.includes(type as ModeTypeParam)) {
      return NextResponse.json({ error: "unsupportedModeType" }, { status: 400 })
    }
    const user = await auditedRequireRole(req, "NURSE", ctx, "PATIENT_MODE", "upsert")
    const body = await req.json()
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      return NextResponse.json({ error: res.error }, {
        status: res.error === "invalidPatientId" ? 400 : 404,
      })
    }
    const allowed = await canAccessPatient(user.id, user.role, res.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT_MODE", resourceId: String(res.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: res.patientId, mode: type, endpoint: "upsert" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    switch (type as ModeTypeParam) {
      case "pediatric": {
        const parsed = pediatricUpsertSchema.safeParse(body)
        if (!parsed.success) {
          return NextResponse.json(
            { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
            { status: 400 },
          )
        }
        const out = await pediatricModeService.upsert(
          res.patientId, parsed.data.caregivers, user.id, ctx,
        )
        return NextResponse.json(out, { status: 201 })
      }
      case "ramadan": {
        const parsed = ramadanUpsertSchema.safeParse(body)
        if (!parsed.success) {
          return NextResponse.json(
            { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
            { status: 400 },
          )
        }
        const out = await ramadanModeService.upsert(
          res.patientId, parsed.data, user.id, ctx,
        )
        return NextResponse.json(out, { status: 201 })
      }
      case "travel": {
        const parsed = travelUpsertSchema.safeParse(body)
        if (!parsed.success) {
          return NextResponse.json(
            { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
            { status: 400 },
          )
        }
        const out = await travelModeService.upsert(
          res.patientId, parsed.data, user.id, ctx,
        )
        return NextResponse.json(out, { status: 201 })
      }
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, `patient/modes/${type} PUT`, ctx.requestId)
  }
}

