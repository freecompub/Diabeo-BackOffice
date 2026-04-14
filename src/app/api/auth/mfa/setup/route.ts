/**
 * POST /api/auth/mfa/setup — authenticated
 *
 * Generates a new TOTP secret (AES-encrypted at rest), returns otpauth URI +
 * QR code data URI for the client to display. `mfaEnabled` stays FALSE until
 * the user confirms a first OTP via /api/auth/mfa/verify.
 *
 * Refuses if MFA is already enabled — caller must disable first. This prevents
 * a stolen session from silently overwriting an existing secret.
 */

import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { mfaService } from "@/lib/services/mfa.service"
import { logger } from "@/lib/logger"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const ctx = extractRequestContext(req)

    // Use a stable, non-PII account label. The otpauth URI is embedded in a
    // QR code the user may photograph; don't leak their email there.
    const label = `user-${user.id}`
    const result = await mfaService.generateSecret(user.id, label)

    // HDS §IV.3 traceability: secret-generation is a sensitive credential
    // operation. Audit the initiation; MFA_ENABLED will follow on /verify.
    await auditService.log({
      userId: user.id,
      action: "MFA_SETUP_INITIATED",
      resource: "USER",
      resourceId: String(user.id),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error && error.message === "mfaAlreadyEnabled") {
      return NextResponse.json({ error: "mfaAlreadyEnabled" }, { status: 409 })
    }
    if (error instanceof Error && error.message === "userNotFound") {
      return NextResponse.json({ error: "userNotFound" }, { status: 404 })
    }
    const ctx = extractRequestContext(req)
    logger.error("auth/mfa/setup", "setup failed", { requestId: ctx.requestId }, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
