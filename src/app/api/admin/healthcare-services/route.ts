/**
 * US-2117 + US-2118 — Admin CRUD des structures de soin (cabinet, hôpital,
 * praticien libéral).
 *
 * GET   → ADMIN — list paginée + filtre type
 * POST  → ADMIN — création (libéral requiert licenseNumber RPPS / ADELI)
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { healthcareManagementService } from "@/lib/services/healthcare-management.service"
import { logger } from "@/lib/logger"

const typeEnum = z.enum(["clinic", "hospital", "freelance"])

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const sp = req.nextUrl.searchParams

    const intSchema = z.coerce.number().int().positive().optional()
    const limitParsed = intSchema.safeParse(sp.get("limit") ?? undefined)
    const cursorParsed = intSchema.safeParse(sp.get("cursor") ?? undefined)
    if (!limitParsed.success || !cursorParsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const typeRaw = sp.get("type")
    const type = typeRaw ? typeEnum.safeParse(typeRaw) : null
    if (type && !type.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const result = await healthcareManagementService.list(
      {
        type: type?.success ? type.data : undefined,
        search: sp.get("search") ?? undefined,
        limit: limitParsed.data,
        cursor: cursorParsed.data,
      },
      user.id,
      ctx,
    )

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/healthcare-services GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(255),
  type: typeEnum,
  establishment: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().length(2).optional().nullable(),
  licenseNumber: z.string().trim().regex(/^([0-9]{9}|[0-9]{11})$/, "license_number_invalid_format").optional().nullable(),
})

const USER_ERROR_CODES = new Map<string, number>([
  ["license_number_required_for_freelance", 400],
  ["license_number_invalid_format", 400],
  ["rpps_checksum_invalid", 400],
  ["adeli_checksum_invalid", 400],
])

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    try {
      const created = await healthcareManagementService.create(parsed.data, user.id, ctx)
      return NextResponse.json(created, { status: 201 })
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
    logger.error("api", "admin/healthcare-services POST failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
