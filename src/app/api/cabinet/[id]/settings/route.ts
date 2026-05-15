/**
 * @route /api/cabinet/[id]/settings
 * @description US-2147 Paramètres cabinet (manager-level).
 *   - GET : lecture des settings
 *   - PUT : mise à jour des settings éditables par le manager
 *
 * RBAC : manager du cabinet OU ADMIN. Champs régaliens (siret, tvaIntra,
 * iban, country, type, licenseNumber) restent sur `/api/admin/healthcare-services`.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import {
  auditedRequireRole,
  mapErrorToResponse,
  assertJsonContentType,
  assertBodySize,
} from "@/lib/team-route-helpers"
import {
  cabinetSettingsService,
  CabinetSettingsAccessError,
  CabinetSettingsNotFoundError,
} from "@/lib/services/cabinet-settings.service"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

const settingsUpdateSchema = z.object({
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  addressLine1: z.string().max(255).nullable().optional(),
  addressLine2: z.string().max(255).nullable().optional(),
  postalCode: z.string().max(10).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  openingHours: z.unknown().nullable().optional(),
  specialties: z.array(z.string().max(60)).max(20).optional(),
  capacity: z.number().int().min(0).max(10_000).nullable().optional(),
  noVideos: z.boolean().optional(),
  noFood: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "no fields to update" })

async function emitAccessDenied(
  userId: number,
  cabinetId: number,
  ctx: { ipAddress: string; userAgent: string; requestId: string },
  reason: string,
): Promise<void> {
  try {
    await auditService.accessDenied({
      userId,
      resource: "CABINET_SETTINGS",
      resourceId: String(cabinetId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { cabinetId, reason },
    })
  } catch { /* swallow */ }
}

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
    const user = await auditedRequireRole(
      req, "DOCTOR", ctx, "CABINET_SETTINGS", String(parsedParams.data.id),
    )
    try {
      const settings = await cabinetSettingsService.get(
        parsedParams.data.id, user.id, user.role, ctx,
      )
      return NextResponse.json({ settings })
    } catch (e) {
      if (e instanceof CabinetSettingsAccessError) {
        await emitAccessDenied(user.id, parsedParams.data.id, ctx, e.message)
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof CabinetSettingsNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    return mapErrorToResponse(e, "cabinet/:id/settings GET", ctx.requestId)
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const sizeErr = assertBodySize(req, 50_000)
    if (sizeErr) return sizeErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(
      req, "DOCTOR", ctx, "CABINET_SETTINGS", String(parsedParams.data.id),
    )

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsedBody = settingsUpdateSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    try {
      const settings = await cabinetSettingsService.update(
        parsedParams.data.id,
        parsedBody.data as Parameters<typeof cabinetSettingsService.update>[1],
        user.id, user.role, ctx,
      )
      return NextResponse.json({ settings })
    } catch (e) {
      if (e instanceof CabinetSettingsAccessError) {
        await emitAccessDenied(user.id, parsedParams.data.id, ctx, e.message)
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof CabinetSettingsNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    return mapErrorToResponse(e, "cabinet/:id/settings PUT", ctx.requestId)
  }
}
