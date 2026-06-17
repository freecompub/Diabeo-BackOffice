/**
 * US-2613 / F2 — Administration plateforme : politiques de vérification PS.
 *
 * GET  → SYSTEM_ADMIN (ADMIN V1) — liste (filtre `?tenantId=` ou `?country=`).
 * POST → SYSTEM_ADMIN — pose une politique (fail-secure : provisional borné + flag prod).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  verificationPolicyService,
  VerificationPolicyError,
  verificationPolicyErrorStatus,
} from "@/lib/services/verification-policy.service"
import { logger } from "@/lib/logger"

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const sp = req.nextUrl.searchParams

    const tenantParsed = z.coerce.number().int().positive().optional().safeParse(sp.get("tenantId") ?? undefined)
    const countryParsed = z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).optional().safeParse(sp.get("country") ?? undefined)
    if (!tenantParsed.success || !countryParsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const items = await verificationPolicyService.list(
      { tenantId: tenantParsed.data, country: countryParsed.data },
      user.id,
      ctx,
    )
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/verification-policies GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const setSchema = z.object({
  tenantId: z.number().int().positive().optional().nullable(),
  country: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).optional().nullable(),
  mode: z.enum(["required", "provisional"]),
  expiresAt: z.coerce.date().optional().nullable(),
})

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const parsed = setSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    try {
      const created = await verificationPolicyService.setPolicy(parsed.data, user.id, ctx)
      return NextResponse.json(created, { status: 201 })
    } catch (e) {
      if (e instanceof VerificationPolicyError) {
        return NextResponse.json({ error: e.code }, { status: verificationPolicyErrorStatus(e.code) })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/verification-policies POST failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
