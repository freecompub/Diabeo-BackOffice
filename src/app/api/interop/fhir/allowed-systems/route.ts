/** US-2123 H5 — FHIR allowlist CRUD (ADMIN). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { fhirAllowedSystemService } from "@/lib/services/fhir-allowed-systems.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const createSchema = z.object({
  origin: z.string().min(1).max(255),
  label: z.string().min(1).max(200),
  dpaReference: z.string().min(1).max(500),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    await auditedRequireRole(req, "ADMIN", ctx, "FHIR_ALLOWED_SYSTEM", "list")
    const items = await fhirAllowedSystemService.list()
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "interop/fhir/allowed-systems GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(req, "ADMIN", ctx, "FHIR_ALLOWED_SYSTEM", "list")
    const out = await fhirAllowedSystemService.create(parsed.data, user.id, ctx)
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "interop/fhir/allowed-systems POST", ctx.requestId)
  }
}
