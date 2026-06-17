/**
 * US-2613 — Administration plateforme : preuves PS en attente de validation.
 *
 * GET → SYSTEM_ADMIN (ADMIN V1) — liste des preuves `unverified`.
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { psRegistrationService } from "@/lib/services/ps-registration.service"
import { logger } from "@/lib/logger"

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const ctx = extractRequestContext(req)
    const items = await psRegistrationService.listPending(user.id, ctx)
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/ps-registrations GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
