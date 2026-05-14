/**
 * Groupe 10 Batch C — DOCTOR validates a mode version (US-2233/2234/2235).
 * POST body: { versionId: number }
 *
 * Enforces : DOCTOR-only ; the ConfigVersion belongs to a patient the caller
 * can access (canAccessPatient) ; configType is a supported mode type.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { prisma } from "@/lib/db/client"
import { patientModeWorkflow } from "@/lib/services/patient-modes.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import { ConfigVersionType } from "@prisma/client"

const SUPPORTED: ConfigVersionType[] = [
  ConfigVersionType.pediatric_mode,
  ConfigVersionType.ramadan_mode,
  ConfigVersionType.travel_mode,
]

const schema = z.object({
  versionId: z.number().int().positive(),
})

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "CONFIG_VERSION", "validate")
    const body = await req.json().catch(() => null)
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    // C1 — ensure the ConfigVersion exists, belongs to a supported mode type
    // AND the caller has access to its patient (cross-tenant guard).
    const row = await prisma.configVersion.findUnique({
      where: { id: parsed.data.versionId },
      select: { id: true, patientId: true, configType: true },
    })
    if (!row || !SUPPORTED.includes(row.configType)) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    if (row.patientId === null) {
      // Orphan (patient deleted) — refuse to validate.
      return NextResponse.json({ error: "patientDeleted" }, { status: 410 })
    }
    const allowed = await canAccessPatient(user.id, user.role, row.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "CONFIG_VERSION", resourceId: String(row.id),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: {
          patientId: row.patientId, configType: row.configType,
          endpoint: "validate",
        },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const out = await patientModeWorkflow.validate(row.id, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patient/modes/validate POST", ctx.requestId)
  }
}
