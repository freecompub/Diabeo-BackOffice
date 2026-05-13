/**
 * US-2019 — Recherche patient (full-text exact match sur HMAC + filtres).
 *
 * Query params:
 *  - `search`     — nom OU prénom EXACT (case-insensitive). HMAC déterministe
 *                   sur User.firstnameHmac / User.lastnameHmac.
 *  - `pathology`  — DT1 / DT2 / GD (exact match).
 *  - `cursor`     — id patient (pagination).
 *  - `limit`      — page size (1..50, défaut 25).
 *
 * Scoping RBAC : ADMIN voit tout, DOCTOR/NURSE limités aux patients de leurs
 * services, VIEWER → own patient. Le `search` ne contourne JAMAIS la scope.
 *
 * Audit : `READ` sur `PATIENT` (`resourceId="search"`) avec le count + flags.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { Pathology } from "@prisma/client"
import { requireRole, AuthError } from "@/lib/auth"
import { getAccessiblePatientIds } from "@/lib/access-control"
import { patientService } from "@/lib/services/patient.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  pathology: z.enum(Pathology).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const ctx = extractRequestContext(req)

    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const accessibleIds = await getAccessiblePatientIds(user.id, user.role)
    const result = await patientService.search(
      {
        search: parsed.data.search,
        pathology: parsed.data.pathology,
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
        accessibleIds,
      },
      user.id,
      ctx,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/search]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
