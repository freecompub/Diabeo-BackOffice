/**
 * @route /api/devices/compatibility
 * @description US-2091 — Référentiel des dispositifs supportés.
 *
 *   - GET : search référentiel (filter par category + brand).
 *           NURSE+ pour pre-pairing UI / patient onboarding.
 *   - POST : crée une entrée référentiel (ADMIN only).
 *
 * Audit : `SUPPORTED_DEVICE/READ` ou `CREATE` avec metadata `kind`.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  auditedRequireRole,
  assertJsonContentType,
  mapErrorToResponse,
} from "@/lib/team-route-helpers"
import {
  supportedDeviceService,
  DeviceLifecycleValidationError,
} from "@/lib/services/device-lifecycle.service"

const DEVICE_CATEGORIES = ["glucometer", "cgm", "insulinPump", "insulinPen", "healthApp"] as const

const searchSchema = z.object({
  category: z.enum(DEVICE_CATEGORIES).optional(),
  brand: z.string().max(100).optional(),
  includeInactive: z.coerce.boolean().optional(),
})

const createSchema = z.object({
  brand: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  category: z.enum(DEVICE_CATEGORIES),
  modelIdentifier: z.string().max(100).optional(),
  connectionTypes: z.array(z.string().max(50)).max(10).optional(),
  sensorLifetimeDays: z.number().int().positive().max(90).optional(),
  isHdsCertified: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = searchSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(
      req, "NURSE", ctx, "SUPPORTED_DEVICE", "search",
    )
    const items = await supportedDeviceService.search(parsed.data, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "devices/compatibility GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    }
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 422 },
      )
    }
    const user = await auditedRequireRole(
      req, "ADMIN", ctx, "SUPPORTED_DEVICE", "create",
    )
    try {
      const created = await supportedDeviceService.create(parsed.data, user.id, ctx)
      return NextResponse.json({ item: created }, { status: 201 })
    } catch (e) {
      if (e instanceof DeviceLifecycleValidationError) {
        return NextResponse.json(
          { error: "validationFailed", field: e.field, message: e.message },
          { status: 422 },
        )
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "devices/compatibility POST", ctx.requestId)
  }
}
