/**
 * @route POST /api/patients/[id]/devices/[deviceId]/revoke
 * @description US-2092 — Soft-revoke un device patient.
 *
 * Idempotent : revoke 2× = no-op (200 avec `alreadyRevoked: true`).
 *
 * Auth : VIEWER own (patient révoque son propre device via app) ou
 *        NURSE+ cabinet member (PS révoque pour le patient).
 * RBAC : `canAccessPatient` AVANT toute lecture (helper unifié
 *        `resolvePatientForConsent` — anti-énumération round 2).
 * Audit : `DEVICE/UPDATE` kind `device.revoked` + pivot `patientId`.
 *
 * Anti-énumération HIGH-2 round 2 review : la route retourne `403 forbidden`
 * UNIFORME pour les non-autorisés, sans distinguer "patient inexistant"
 * vs "patient sans consent" vs "RBAC denied". Discrimination réservée
 * aux callers ayant prouvé `canAccessPatient = true`.
 *
 * Body : `{ reason: string }` (max 500 chars UTF-8 / max bytes Zod, chiffré
 * AES-256-GCM — peut contenir PHI ex. "remplacé suite dysfonctionnement").
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import {
  assertJsonContentType,
  assertBodySize,
  mapErrorToResponse,
} from "@/lib/team-route-helpers"
import { resolvePatientForConsent } from "@/lib/access-control"
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
  reason: z.string()
    .min(1)
    .max(DEVICE_LIFECYCLE_BOUNDS.MAX_REASON_LEN)
    // M1 round 2 review — byte-length cap UTF-8 (defense-in-depth vs
    // VARCHAR(2816) DB column). Anti truncation silencieuse pour
    // payloads multi-octets (arabe US-2112, emojis).
    .refine(
      (v) => Buffer.byteLength(v, "utf8") <= DEVICE_LIFECYCLE_BOUNDS.MAX_REASON_BYTES,
      { message: "reasonTooLongBytes" },
    ),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; deviceId: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    // L1 review — tighten body size cap (était 4000, Zod max 500 chars +
    // wrapping JSON ≈ 600). Marge 2× sécurité.
    const sizeErr = assertBodySize(req, 1_024)
    if (sizeErr) return sizeErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = requireAuth(req)

    // HIGH-2 round 2 review — RBAC AVANT findFirst (anti-énumération).
    // Le helper `resolvePatientForConsent` chaîne :
    //   1. canAccessPatient (RBAC) → audit accessDenied si fail
    //   2. patient.findFirst (résolution userId data subject)
    //   3. requireGdprConsent (consent du data subject — CR H4)
    // Tous les 3 cas d'échec → null → 403 forbidden uniforme.
    const resolved = await resolvePatientForConsent(
      user.id, user.role, parsedParams.data.id,
      {
        onAccessDenied: async () => {
          await auditService.accessDenied({
            userId: user.id,
            resource: "DEVICE",
            resourceId: String(parsedParams.data.id),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: { kind: "device.revoke.accessDenied" },
          }).catch(() => undefined) // fire-and-forget
        },
      },
    )
    if (!resolved) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
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
        // Device introuvable pour ce patient → 404 OK car le caller a déjà
        // prouvé l'accès au patient via resolvePatientForConsent.
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
