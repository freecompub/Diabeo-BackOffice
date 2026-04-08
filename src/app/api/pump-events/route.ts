/**
 * @module /api/pump-events
 * @description Pump event routes — GET (list), POST (create), DELETE (remove).
 * US-304 — Insulin flow & pump events.
 * Pump events track alarms, suspends, resets, bolus deliveries from insulin pumps.
 * All operations require auth + GDPR consent + audit logging.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { extractRequestContext } from "@/lib/services/audit.service"

/** Allowed pump event types — aligns with device data standards */
const PUMP_EVENT_TYPES = [
  "alarm", "suspend", "resume", "prime", "rewind",
  "bolusDelivery", "basalChange", "cartridgeChange", "cannulaChange",
] as const

const querySchema = z.object({
  patientId: z.coerce.number().int().positive().optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  eventType: z.enum(PUMP_EVENT_TYPES).optional(),
})

const createSchema = z.object({
  patientId: z.number().int().positive().optional(),
  timestamp: z.coerce.date(),
  eventType: z.enum(PUMP_EVENT_TYPES),
  data: z.record(z.string(), z.unknown()).optional().refine(
    (d) => !d || JSON.stringify(d).length <= 4096,
    { message: "data payload must be under 4KB" },
  ),
})

const deleteSchema = z.object({
  id: z.coerce.number().int().positive(),
  patientId: z.coerce.number().int().positive().optional(),
})

/**
 * GET /api/pump-events?from=&to=&patientId=&eventType=
 * Returns pump events for a patient within a date range.
 */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const params = Object.fromEntries(req.nextUrl.searchParams)
    const parsed = querySchema.safeParse(params)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { from, to, eventType, patientId: pidParam } = parsed.data
    const patientId = await resolvePatientId(user.id, user.role, pidParam)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const ctx = extractRequestContext(req)
    const events = await glycemiaService.getPumpEvents(
      patientId, from, to, user.id, ctx, eventType,
    )

    return NextResponse.json(events)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    if (msg.includes("Period cannot exceed")) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error("[pump-events GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/**
 * POST /api/pump-events
 * Create a new pump event for a patient. Requires NURSE+ role.
 */
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { patientId: pidParam, data, ...rest } = parsed.data
    const patientId = await resolvePatientId(user.id, user.role, pidParam)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const ctx = extractRequestContext(req)
    const eventInput = {
      ...rest,
      data: data as Prisma.InputJsonValue | undefined,
    }
    const event = await glycemiaService.createPumpEvent(
      patientId, eventInput, user.id, ctx,
    )

    return NextResponse.json(event, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[pump-events POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/**
 * DELETE /api/pump-events?id=&patientId=
 * Delete a pump event by ID. Requires NURSE+ role.
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const params = Object.fromEntries(req.nextUrl.searchParams)
    const parsed = deleteSchema.safeParse(params)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // S1 fix: verify the pump event belongs to the caller's patient
    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const ctx = extractRequestContext(req)

    // Verify event ownership before deleting
    const ownershipOk = await glycemiaService.verifyPumpEventOwnership(
      parsed.data.id, patientId,
    )
    if (!ownershipOk) {
      return NextResponse.json({ error: "pumpEventNotFound" }, { status: 404 })
    }

    const result = await glycemiaService.deletePumpEvent(
      parsed.data.id, user.id, ctx,
    )

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[pump-events DELETE]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
