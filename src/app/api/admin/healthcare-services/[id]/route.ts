/**
 * US-2117 + US-2118 — Admin détail / mise à jour d'une structure de soin.
 *
 * GET    → ADMIN — détail (incluant member count + members)
 * PATCH  → ADMIN — update (validation freelance impose licenseNumber)
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { ServiceType } from "@prisma/client"
import { requireRole, AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  healthcareManagementService,
  openingHoursSchema,
} from "@/lib/services/healthcare-management.service"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: Promise<{ id: string }>
}

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "ADMIN")
    const { id: rawId } = await params
    const id = parseId(rawId)
    if (id === null) {
      return NextResponse.json({ error: "invalidServiceId" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const service = await healthcareManagementService.getById(id, user.id, ctx)
    if (!service) {
      return NextResponse.json({ error: "serviceNotFound" }, { status: 404 })
    }
    return NextResponse.json(service)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "admin/healthcare-services/[id] GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  type: z.nativeEnum(ServiceType).optional(),
  establishment: z.string().trim().max(255).nullable().optional(),
  addressLine1: z.string().trim().max(255).nullable().optional(),
  addressLine2: z.string().trim().max(255).nullable().optional(),
  postalCode: z.string().trim().max(10).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().length(2).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  website: z.string().trim().url().max(500).nullable().optional(),
  openingHours: openingHoursSchema.nullable().optional(),
  specialties: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  capacity: z.number().int().min(0).max(10_000).nullable().optional(),
  managerId: z.number().int().positive().nullable().optional(),
  licenseNumber: z.string().trim().regex(/^([0-9]{9}|[0-9]{11})$/, "license_number_invalid_format").nullable().optional(),
})

const USER_ERROR_CODES = new Map<string, number>([
  ["service_not_found", 404],
  ["license_number_required_for_freelance", 400],
  ["license_number_invalid_format", 400],
  ["rpps_checksum_invalid", 400],
  ["adeli_checksum_invalid", 400],
  ["opening_hours_invalid_shape", 400],
  ["opening_hours_invalid_range", 400],
  ["opening_hours_invalid_time_format", 400],
  ["opening_hours_close_before_open", 400],
  ["opening_hours_ranges_overlap", 400],
  // 404 = ressource référencée absente (cohérent avec `service_not_found`).
  ["manager_not_found", 404],
  ["manager_role_invalid", 400],
  ["manager_inactive", 400],
])

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "ADMIN")
    const { id: rawId } = await params
    const id = parseId(rawId)
    if (id === null) {
      return NextResponse.json({ error: "invalidServiceId" }, { status: 400 })
    }

    const body = await req.json()
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    try {
      const updated = await healthcareManagementService.update(id, parsed.data, user.id, ctx)
      return NextResponse.json(updated)
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
    logger.error("api", "admin/healthcare-services/[id] PATCH failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
