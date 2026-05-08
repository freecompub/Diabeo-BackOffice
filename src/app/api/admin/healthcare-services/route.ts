/**
 * US-2117 + US-2118 — Admin CRUD des structures de soin (cabinet, hôpital,
 * praticien libéral).
 *
 * GET   → ADMIN — list paginée + filtre type
 * POST  → ADMIN — création (libéral requiert licenseNumber RPPS / ADELI)
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { ServiceType } from "@prisma/client"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  healthcareManagementService,
  TIME_REGEX,
} from "@/lib/services/healthcare-management.service"
import { logger } from "@/lib/logger"

// Dérivé du Prisma enum : ajout d'une valeur côté schema → route alignée
// automatiquement, plus de littéraux dupliqués à maintenir en parallèle.
const typeEnum = z.nativeEnum(ServiceType)

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

/** US-2117 — DaySchedule = list of [open, close] HH:MM ranges. */
const timeSchema = z.string().regex(TIME_REGEX, "time_format_invalid")
const daySchema = z.array(z.tuple([timeSchema, timeSchema])).max(4)
const openingHoursSchema = z.object({
  mon: daySchema.optional(),
  tue: daySchema.optional(),
  wed: daySchema.optional(),
  thu: daySchema.optional(),
  fri: daySchema.optional(),
  sat: daySchema.optional(),
  sun: daySchema.optional(),
})

const createSchema = z.object({
  name: z.string().trim().min(2).max(255),
  type: typeEnum,
  establishment: z.string().trim().max(255).optional().nullable(),
  addressLine1: z.string().trim().max(255).optional().nullable(),
  addressLine2: z.string().trim().max(255).optional().nullable(),
  postalCode: z.string().trim().max(10).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().length(2).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().max(255).optional().nullable(),
  website: z.string().trim().url().max(500).optional().nullable(),
  openingHours: openingHoursSchema.optional().nullable(),
  specialties: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  capacity: z.number().int().min(0).max(10_000).optional().nullable(),
  managerId: z.number().int().positive().optional().nullable(),
  licenseNumber: z.string().trim().regex(/^([0-9]{9}|[0-9]{11})$/, "license_number_invalid_format").optional().nullable(),
})

const USER_ERROR_CODES = new Map<string, number>([
  ["license_number_required_for_freelance", 400],
  ["license_number_invalid_format", 400],
  ["rpps_checksum_invalid", 400],
  ["adeli_checksum_invalid", 400],
  ["opening_hours_invalid_shape", 400],
  ["opening_hours_invalid_range", 400],
  ["opening_hours_invalid_time_format", 400],
  ["opening_hours_close_before_open", 400],
  ["opening_hours_ranges_overlap", 400],
  ["manager_not_found", 400],
  ["manager_role_invalid", 400],
  ["manager_inactive", 400],
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
