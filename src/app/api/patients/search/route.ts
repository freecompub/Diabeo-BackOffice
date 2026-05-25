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

/**
 * Fix CR-H1 round 1 review PR #434 — Headers ANSSI RGS §4.5 + RGPD Art. 32
 * sur la réponse qui contient des PHI déchiffrés (`user.firstname`/`lastname`
 * de tous les patients accessibles via RBAC). Sans `no-store`, le bfcache
 * navigateur + proxies cacheables (Nginx mal configuré, CDN client-side)
 * peuvent retenir la liste patients.
 *
 * Asymétrie corrigée vs autres routes PHI (cf. helper partagé
 * `setAppointmentSecurityHeaders` pour `/api/appointments/*` PR #433).
 * Pas factorisé dans un helper global pour rester scope minimal — pattern
 * à généraliser V1.5 via middleware Next.js (cf. HSA-2-10 PR #433).
 */
function setPatientsSearchSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
  res.headers.set("Pragma", "no-cache")
  res.headers.set("Referrer-Policy", "no-referrer")
  res.headers.set("X-Content-Type-Options", "nosniff")
  return res
}

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
      return setPatientsSearchSecurityHeaders(
        NextResponse.json(
          { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
          { status: 400 },
        ),
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
    return setPatientsSearchSecurityHeaders(NextResponse.json(result))
  } catch (error) {
    if (error instanceof AuthError) {
      return setPatientsSearchSecurityHeaders(
        NextResponse.json({ error: error.message }, { status: error.status }),
      )
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/search]", msg)
    return setPatientsSearchSecurityHeaders(
      NextResponse.json({ error: "serverError" }, { status: 500 }),
    )
  }
}
