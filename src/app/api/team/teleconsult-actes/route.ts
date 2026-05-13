/** US-2072 — Acte de téléconsultation (lien facturation appointment). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { teleconsultActeService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

const schema = z.object({
  appointmentId: z.number().int().positive(),
  billingCode: z.string().regex(/^[A-Z0-9]{2,20}$/),
  amountCents: z.number().int().min(0).max(1_000_000).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "DOCTOR")
    const ctx = extractRequestContext(req)
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const row = await teleconsultActeService.create(parsed.data, user.id, ctx)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return mapErrorToResponse(e, "team/teleconsult-actes POST")
  }
}
