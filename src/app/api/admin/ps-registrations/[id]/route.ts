/**
 * US-2613 — Administration plateforme : statuer sur une preuve PS.
 *
 * PATCH → SYSTEM_ADMIN (ADMIN V1) — body `{ decision: "verified" | "rejected" }`.
 * Seules les preuves `unverified` sont décidables (sinon 409).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  psRegistrationService,
  PsRegistrationError,
  psRegistrationErrorStatus,
} from "@/lib/services/ps-registration.service"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: Promise<{ id: string }>
}

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

const bodySchema = z.object({ decision: z.enum(["verified", "rejected"]) })

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "ADMIN")
    const id = parseId((await params).id)
    if (id === null) return NextResponse.json({ error: "invalidRegistrationId" }, { status: 400 })

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    try {
      await psRegistrationService.decide(id, parsed.data.decision, user.id, ctx)
      return NextResponse.json({ ok: true })
    } catch (e) {
      if (e instanceof PsRegistrationError) {
        return NextResponse.json({ error: e.code }, { status: psRegistrationErrorStatus(e.code) })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/ps-registrations/[id] PATCH failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
