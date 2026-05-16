/**
 * @route /api/patients/[id]/ins
 * @description US-2026 — INS (Identite Nationale Sante) — CRUD patient-scoped.
 *
 *   - GET    : lecture INS dechiffre (NURSE+ cabinet OR VIEWER own).
 *   - PUT    : set/update INS (DOCTOR+ — saisie cabinet OR VIEWER own).
 *   - DELETE : clear INS (DOCTOR+ OR ADMIN — efface saisie erronee).
 *
 * Anti-enumeration : helper unifie `resolvePatientForConsent` (PR #415 H2)
 * verifie RBAC + existence + consent en un seul appel, retourne 403
 * forbidden uniforme pour les non-autorises.
 *
 * Rate-limit anti-enumeration RNIPP (H2 round 2) : 5 collisions/24h max
 * par auditUserId → 429 RateLimited (audit + SOC alerte).
 *
 * Headers ANSSI RGS §4.5 (M2 round 2) :
 *   - Cache-Control: no-store, private
 *   - Referrer-Policy: no-referrer
 *   - X-Content-Type-Options: nosniff
 *   - Content-Security-Policy: default-src 'none'
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import type { Role } from "@prisma/client"
import { AuthError, requireAuth } from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import {
  assertJsonContentType,
  assertBodySize,
  mapErrorToResponse,
} from "@/lib/team-route-helpers"
import { resolvePatientForConsent } from "@/lib/access-control"
import {
  insService,
  InsValidationError,
  InsCollisionError,
  InsCollisionRateLimitError,
  InsNotFoundError,
  INS_AUDIT_KIND,
} from "@/lib/services/ins.service"

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const putBodySchema = z.object({
  ins: z.string().min(15).max(25), // 15 chiffres + marge espaces
})

// M2 round 2 review — Headers ANSSI RGS §4.5 sur toutes les routes INS.
// PHI defense-en-profondeur (cache navigateur/proxy, Referer leak, MIME
// sniffing, CSP fallback no-resource).
const ANSSI_SECURITY_HEADERS = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'",
} as const

// ─────────────────────────────────────────────────────────────
// Helper RBAC role-gated write/clear (L5 round 3 — Role enum import).
// ─────────────────────────────────────────────────────────────
function canWriteIns(role: Role): boolean {
  // VIEWER peut definir son propre INS (auto-onboarding patient).
  // NURSE = lecture uniquement (DOCTOR cree, NURSE consulte).
  // ADMIN = full (audit + correctif).
  // H5 round 2 review — l'audit metadata `setByRole` trace le role qui a
  // saisi, le DPO peut filtrer "INS saisi par VIEWER" pour identitovigilance.
  return role === "ADMIN" || role === "DOCTOR" || role === "VIEWER"
}

function canDeleteIns(role: Role): boolean {
  // VIEWER (patient) ne peut PAS clear son INS — passe par DOCTOR/ADMIN
  // ou bien suppression compte RGPD Art. 17.
  return role === "ADMIN" || role === "DOCTOR"
}

function jsonWithSecurityHeaders(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: ANSSI_SECURITY_HEADERS })
}

// ─────────────────────────────────────────────────────────────
// GET — lecture INS dechiffre
// ─────────────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return jsonWithSecurityHeaders({ error: "validationFailed" }, 400)
    }
    const user = requireAuth(req)

    const resolved = await resolvePatientForConsent(
      user.id, user.role, parsedParams.data.id,
      {
        onAccessDenied: async () => {
          await auditService.accessDenied({
            userId: user.id,
            resource: "USER_INS",
            resourceId: String(parsedParams.data.id),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: { kind: INS_AUDIT_KIND.ACCESS_DENIED },
          }).catch(() => undefined)
        },
      },
    )
    if (!resolved) {
      return jsonWithSecurityHeaders({ error: "forbidden" }, 403)
    }

    try {
      const result = await insService.getIns(
        resolved.ownerUserId, user.id, ctx,
        { patientId: resolved.patientId },
      )
      return jsonWithSecurityHeaders({
        ins: result.ins,
        hasIns: result.hasIns,
        qualityStatus: result.qualityStatus,
        setAt: result.setAt?.toISOString() ?? null,
      })
    } catch (e) {
      if (e instanceof InsNotFoundError) {
        return jsonWithSecurityHeaders({ error: "notFound" }, 404)
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonWithSecurityHeaders({ error: e.message }, e.status)
    }
    return mapErrorToResponse(e, "patients/:id/ins GET", ctx.requestId)
  }
}

// ─────────────────────────────────────────────────────────────
// PUT — set/update INS
// ─────────────────────────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const sizeErr = assertBodySize(req, 256) // payload micro
    if (sizeErr) return sizeErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return jsonWithSecurityHeaders({ error: "validationFailed" }, 400)
    }
    const user = requireAuth(req)

    const resolved = await resolvePatientForConsent(
      user.id, user.role, parsedParams.data.id,
      {
        onAccessDenied: async () => {
          await auditService.accessDenied({
            userId: user.id,
            resource: "USER_INS",
            resourceId: String(parsedParams.data.id),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: { kind: INS_AUDIT_KIND.ACCESS_DENIED },
          }).catch(() => undefined)
        },
      },
    )
    if (!resolved) {
      return jsonWithSecurityHeaders({ error: "forbidden" }, 403)
    }

    if (!canWriteIns(user.role)) {
      return jsonWithSecurityHeaders({ error: "forbidden" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return jsonWithSecurityHeaders({ error: "invalidJSON" }, 400)
    }
    const parsedBody = putBodySchema.safeParse(body)
    if (!parsedBody.success) {
      return jsonWithSecurityHeaders(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        422,
      )
    }

    try {
      const result = await insService.setIns(
        resolved.ownerUserId, parsedBody.data.ins, user.id, user.role, ctx,
        { patientId: resolved.patientId },
      )
      return jsonWithSecurityHeaders({
        updated: result.updated,
        qualityStatus: result.qualityStatus,
      })
    } catch (e) {
      if (e instanceof InsValidationError) {
        return jsonWithSecurityHeaders(
          { error: "validationFailed", field: e.field, reason: e.reason },
          422,
        )
      }
      if (e instanceof InsCollisionError) {
        return jsonWithSecurityHeaders({ error: "insAlreadyRegistered" }, 409)
      }
      if (e instanceof InsCollisionRateLimitError) {
        // H2 round 2 — rate-limit anti-enumeration RNIPP.
        return NextResponse.json(
          { error: "rateLimited", retryAfterSec: e.retryAfterSec },
          {
            status: 429,
            headers: {
              ...ANSSI_SECURITY_HEADERS,
              "Retry-After": String(e.retryAfterSec),
            },
          },
        )
      }
      if (e instanceof InsNotFoundError) {
        return jsonWithSecurityHeaders({ error: "notFound" }, 404)
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonWithSecurityHeaders({ error: e.message }, e.status)
    }
    return mapErrorToResponse(e, "patients/:id/ins PUT", ctx.requestId)
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE — clear INS (DOCTOR+/ADMIN — correctif saisie erronee)
// ─────────────────────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return jsonWithSecurityHeaders({ error: "validationFailed" }, 400)
    }
    const user = requireAuth(req)

    const resolved = await resolvePatientForConsent(
      user.id, user.role, parsedParams.data.id,
      {
        onAccessDenied: async () => {
          await auditService.accessDenied({
            userId: user.id,
            resource: "USER_INS",
            resourceId: String(parsedParams.data.id),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: { kind: INS_AUDIT_KIND.ACCESS_DENIED },
          }).catch(() => undefined)
        },
      },
    )
    if (!resolved) {
      return jsonWithSecurityHeaders({ error: "forbidden" }, 403)
    }

    if (!canDeleteIns(user.role)) {
      return jsonWithSecurityHeaders({ error: "forbidden" }, 403)
    }

    const result = await insService.clearIns(
      resolved.ownerUserId, user.id, user.role, ctx,
      { patientId: resolved.patientId, reason: "manual" },
    )
    return jsonWithSecurityHeaders(result)
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonWithSecurityHeaders({ error: e.message }, e.status)
    }
    return mapErrorToResponse(e, "patients/:id/ins DELETE", ctx.requestId)
  }
}
