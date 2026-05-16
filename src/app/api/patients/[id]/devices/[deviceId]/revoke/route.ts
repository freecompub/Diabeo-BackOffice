/**
 * @route POST /api/patients/[id]/devices/[deviceId]/revoke
 * @description US-2092 — Soft-revoke un device patient.
 *
 * Idempotent : revoke 2× = no-op (200 avec `alreadyRevoked: true`).
 *
 * Auth : VIEWER own (patient révoque son propre device via app) ou
 *        NURSE+ cabinet member (PS révoque pour le patient).
 * RBAC : `canAccessPatient` (ADMIN/cabinet/owner-VIEWER).
 * Audit : `DEVICE/UPDATE` kind `device.revoked` + pivot `patientId`.
 *
 * Body : `{ reason: string }` (max 500 chars, chiffré AES-256-GCM avant
 * stockage — peut contenir PHI ex. "remplacé suite dysfonctionnement").
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  assertJsonContentType,
  assertBodySize,
  mapErrorToResponse,
} from "@/lib/team-route-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import {
  deviceLifecycleService,
  DEVICE_LIFECYCLE_BOUNDS,
  DeviceLifecycleValidationError,
  DeviceLifecycleAccessError,
  DeviceLifecycleNotFoundError,
} from "@/lib/services/device-lifecycle.service"

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
  deviceId: z.coerce.number().int().positive(),
})

const bodySchema = z.object({
  reason: z.string().min(1).max(DEVICE_LIFECYCLE_BOUNDS.MAX_REASON_LEN),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; deviceId: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const sizeErr = assertBodySize(req, 4_000)
    if (sizeErr) return sizeErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = requireAuth(req)
    // Consent RGPD Art. 9 — device = device médical patient.
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    }
    const parsedBody = bodySchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 422 },
      )
    }

    try {
      const result = await deviceLifecycleService.revoke(
        parsedParams.data.id,
        parsedParams.data.deviceId,
        parsedBody.data.reason,
        user.id, user.role, ctx,
      )
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store, private" },
      })
    } catch (e) {
      if (e instanceof DeviceLifecycleNotFoundError) {
        return NextResponse.json({ error: "notFound" }, { status: 404 })
      }
      if (e instanceof DeviceLifecycleAccessError) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      if (e instanceof DeviceLifecycleValidationError) {
        return NextResponse.json(
          { error: "validationFailed", field: e.field },
          { status: 422 },
        )
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "patients/:id/devices/:deviceId/revoke POST", ctx.requestId)
  }
}
