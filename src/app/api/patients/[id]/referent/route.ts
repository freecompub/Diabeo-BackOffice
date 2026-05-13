/**
 * US-2021 — Transfert du médecin référent d'un patient.
 * US-2028 — Vue multi-praticiens (membres des services rattachés).
 *
 * Sécurité (post-review PR #389):
 *  - M6 : GET sous `requireRole("NURSE")` (n'expose pas l'équipe au VIEWER).
 *  - C3 : PUT n'autorise que ADMIN, référent courant, ou self-claim.
 *    Filtre passé en argument au service (`isAdmin`) qui applique la règle
 *    intra-transaction.
 *  - H1 : `patientShareConsent` (RGPD Art. 7.3).
 *  - H6 : pré-check existence patient avant `accessDenied`.
 *  - H8 : `MemberNotEligibleError` / `ReferentTransferForbiddenError` typés.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { patientReferentService } from "@/lib/services/patient-referent.service"
import {
  MemberNotEligibleError,
  ReferentTransferForbiddenError,
} from "@/lib/services/patient-tag.errors"
import { prisma } from "@/lib/db/client"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const transferSchema = z.object({
  newProMemberId: z.number().int().positive(),
})

async function readPatientId(params: RouteParams["params"]) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return null
  return parseInt(id, 10)
}

async function ensurePatientAlive(patientId: number): Promise<boolean> {
  const p = await prisma.patient.findFirst({
    where: { id: patientId, deletedAt: null }, select: { id: true },
  })
  return !!p
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const patientId = await readPatientId(params)
    if (patientId === null) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })

    const ctx = extractRequestContext(req)

    if (!(await ensurePatientAlive(patientId))) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "REFERENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const consent = await patientShareConsent(patientId)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error }, { status: consent.status })
    }

    const entries = await patientReferentService.getReferentsView(patientId, user.id, ctx)
    return NextResponse.json({ items: entries })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/referent GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const patientId = await readPatientId(params)
    if (patientId === null) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })

    const ctx = extractRequestContext(req)

    if (!(await ensurePatientAlive(patientId))) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "REFERENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "transfer" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const consent = await patientShareConsent(patientId)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error }, { status: consent.status })
    }

    const body = await req.json()
    const parsed = transferSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await patientReferentService.transferReferent(
      patientId, parsed.data.newProMemberId, user.id, user.role === "ADMIN", ctx,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof MemberNotEligibleError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    if (error instanceof ReferentTransferForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/referent PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
