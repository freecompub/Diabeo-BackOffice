/**
 * US-2025 — Génération d'une invitation mobile QR code pour un patient.
 *
 * POST → DOCTOR / ADMIN — crée un token JWT court (24h, audience dédiée)
 *        et retourne `{ token, deepLink, fallbackUrl, expiresAt }` que
 *        l'UI transforme en QR.
 *
 * **Sécurité** : le token est PHI-adjacent (lien direct vers données patient
 * lors de la redemption). Il n'est jamais persisté en clair côté serveur, ne
 * doit pas être loggué (audit metadata = jti opaque + expiresAt).
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mobileInvitationService } from "@/lib/services/mobile-invitation.service"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: Promise<{ id: string }>
}

const USER_ERROR_CODES = new Map<string, number>([
  ["patient_not_found", 404],
  ["forbidden", 403],
])

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    // DOCTOR ou ADMIN — pas NURSE (clinical decision : signer une invite
    // patient = engagement de prise en charge).
    const user = requireRole(req, "DOCTOR")
    const { id: rawId } = await params
    const patientId = Number.parseInt(rawId, 10)
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    try {
      const result = await mobileInvitationService.createInvite(
        { patientId, invitedBy: user.id, invitedByRole: user.role },
        ctx,
      )
      return NextResponse.json(result, { status: 201 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "serverError"
      const status = USER_ERROR_CODES.get(msg)
      if (status) {
        return NextResponse.json({ error: msg }, { status })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "patients/[id]/invite POST failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
