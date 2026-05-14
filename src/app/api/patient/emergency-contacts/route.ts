/** US-2218 — Emergency contacts (max 5/patient). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import {
  emergencyContactService,
} from "@/lib/services/mirror-v1-config.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const upsertSchema = z.object({
  contacts: z.array(z.object({
    rank: z.number().int().min(1).max(5),
    name: z.string().min(1).max(100),
    phone: z.string().min(1).max(20),
    relationship: z.string().min(1).max(50),
  })).max(5),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "VIEWER", ctx, "EMERGENCY_CONTACT", "0")
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    // C1 (re-review) — block cross-tenant PHI reads.
    const allowed = await canAccessPatient(user.id, user.role, res.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "EMERGENCY_CONTACT", resourceId: String(res.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: res.patientId, endpoint: "list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    // H6 — GDPR consent required before decrypting PHI.
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const out = await emergencyContactService.list(res.patientId, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "emergency-contacts GET", ctx.requestId)
  }
}

export async function PUT(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "EMERGENCY_CONTACT", "upsert")
    const body = await req.json()
    const parsed = upsertSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    const allowed = await canAccessPatient(user.id, user.role, res.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "EMERGENCY_CONTACT", resourceId: String(res.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: res.patientId, endpoint: "upsert" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    // C1-NEW — GDPR consent required to write PHI (name/phone encrypted).
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const out = await emergencyContactService.upsert(
      res.patientId, parsed.data.contacts, user.id, ctx,
    )
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "emergency-contacts PUT", ctx.requestId)
  }
}
