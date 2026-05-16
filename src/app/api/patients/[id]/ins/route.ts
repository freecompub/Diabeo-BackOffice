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
 * Cache-Control: no-store (ANSSI RGS §4.5 — donnee identifiante sensible
 * jamais cachee navigateur/proxy).
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
  insService,
  InsValidationError,
  InsCollisionError,
  InsNotFoundError,
} from "@/lib/services/ins.service"

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const putBodySchema = z.object({
  // Accepte espaces (Zod min/max sur normalised) — la normalisation finale
  // est faite par le service (`normalizeIns`).
  ins: z.string().min(15).max(25), // 15 chiffres min, marge pour 5 espaces
})

// ─────────────────────────────────────────────────────────────
// Helper RBAC role-gated write/clear (DOCTOR+ OR VIEWER own pour set).
// ─────────────────────────────────────────────────────────────
function canWriteIns(role: "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"): boolean {
  // VIEWER peut definir/clear son propre INS (auto-onboarding patient).
  // NURSE = lecture uniquement (cf. spec — DOCTOR cree, NURSE consulte).
  // ADMIN = full (audit + correctif).
  return role === "ADMIN" || role === "DOCTOR" || role === "VIEWER"
}

function canDeleteIns(role: "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"): boolean {
  // VIEWER (patient) ne peut PAS clear son INS — passe par DOCTOR/ADMIN
  // ou bien suppression compte RGPD Art. 17.
  return role === "ADMIN" || role === "DOCTOR"
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
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
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
            metadata: { kind: "user.ins.accessDenied" },
          }).catch(() => undefined)
        },
      },
    )
    if (!resolved) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    try {
      const result = await insService.getIns(
        resolved.ownerUserId, user.id, ctx,
        { patientId: resolved.patientId },
      )
      return NextResponse.json(
        { ins: result.ins, hasIns: result.hasIns },
        { headers: { "Cache-Control": "no-store, private" } },
      )
    } catch (e) {
      if (e instanceof InsNotFoundError) {
        return NextResponse.json({ error: "notFound" }, { status: 404 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
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
    const sizeErr = assertBodySize(req, 256) // payload micro : {"ins": "..."}
    if (sizeErr) return sizeErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
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
            metadata: { kind: "user.ins.accessDenied" },
          }).catch(() => undefined)
        },
      },
    )
    if (!resolved) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    // Role-gate write : NURSE ne peut pas set (lecture uniquement).
    if (!canWriteIns(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    }
    const parsedBody = putBodySchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 422 },
      )
    }

    try {
      await insService.setIns(
        resolved.ownerUserId, parsedBody.data.ins, user.id, ctx,
        { patientId: resolved.patientId },
      )
      return NextResponse.json(
        { updated: true },
        { headers: { "Cache-Control": "no-store, private" } },
      )
    } catch (e) {
      if (e instanceof InsValidationError) {
        return NextResponse.json(
          { error: "validationFailed", field: e.field, reason: e.reason },
          { status: 422 },
        )
      }
      if (e instanceof InsCollisionError) {
        return NextResponse.json({ error: "insAlreadyRegistered" }, { status: 409 })
      }
      if (e instanceof InsNotFoundError) {
        return NextResponse.json({ error: "notFound" }, { status: 404 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
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
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
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
            metadata: { kind: "user.ins.accessDenied" },
          }).catch(() => undefined)
        },
      },
    )
    if (!resolved) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    // Role-gate : DELETE reserve DOCTOR+/ADMIN (VIEWER passe par compte deletion RGPD).
    if (!canDeleteIns(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const result = await insService.clearIns(
      resolved.ownerUserId, user.id, ctx,
      { patientId: resolved.patientId, reason: "manual" },
    )
    return NextResponse.json(
      result,
      { headers: { "Cache-Control": "no-store, private" } },
    )
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "patients/:id/ins DELETE", ctx.requestId)
  }
}
