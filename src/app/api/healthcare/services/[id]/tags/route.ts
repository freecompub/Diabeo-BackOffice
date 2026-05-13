/**
 * US-2022 — CRUD tags du cabinet.
 *
 * Sécurité (post-review PR #389):
 *  - C1 : membership check délégué au service (`listForService` rejette
 *    un caller non-membre du cabinet ciblé).
 *  - H8 : `TagForbiddenError`, `TagValidationError`, `TagLabelPiiError` typés.
 *  - H9 : conflit unique détecté via `Prisma.PrismaClientKnownRequestError`
 *    code `P2002` (pas de match sur message string).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { requireRole, AuthError } from "@/lib/auth"
import {
  patientTagService,
  TagValidationError,
} from "@/lib/services/patient-tag.service"
import {
  TagForbiddenError,
  TagLabelPiiError,
} from "@/lib/services/patient-tag.errors"
import { extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const createSchema = z.object({
  label: z.string().trim().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
})

async function readServiceId(params: RouteParams["params"]) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return null
  return parseInt(id, 10)
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const serviceId = await readServiceId(params)
    if (serviceId === null) return NextResponse.json({ error: "invalidServiceId" }, { status: 400 })

    const ctx = extractRequestContext(req)
    const result = await patientTagService.listForService(serviceId, user.id, ctx)
    return NextResponse.json({ items: result.tags })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof TagForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[healthcare/services/:id/tags GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const serviceId = await readServiceId(params)
    if (serviceId === null) return NextResponse.json({ error: "invalidServiceId" }, { status: 400 })

    const ctx = extractRequestContext(req)
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const tag = await patientTagService.create(
      { serviceId, label: parsed.data.label, color: parsed.data.color },
      user.id, ctx,
    )
    return NextResponse.json(tag, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof TagValidationError) {
      return NextResponse.json({ error: error.message, field: error.field }, { status: 422 })
    }
    if (error instanceof TagLabelPiiError) {
      return NextResponse.json({ error: "labelLooksLikePii", reason: error.reason }, { status: 422 })
    }
    if (error instanceof TagForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    // H9 — Prisma P2002 (unique constraint violation), stable across versions.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "labelAlreadyExists" }, { status: 409 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[healthcare/services/:id/tags POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
