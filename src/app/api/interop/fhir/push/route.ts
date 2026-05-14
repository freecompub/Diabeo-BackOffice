/** US-2123 — Enqueue a FHIR R4 Patient resource for outbound PUSH (DOCTOR). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { prisma } from "@/lib/db/client"
import {
  fhirInteropService,
  buildFhirPatient,
} from "@/lib/services/fhir-interop.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import { safeDecryptField } from "@/lib/crypto/fields"

const schema = z.object({
  patientId: z.number().int().positive(),
  externalSystemUrl: z.string().url().max(500),
})

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "FHIR_INTEROP", "push")

    const allowed = await canAccessPatient(user.id, user.role, parsed.data.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "FHIR_INTEROP",
        resourceId: String(parsed.data.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: parsed.data.patientId, endpoint: "fhir-push" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(parsed.data.patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    // Fetch the patient + their (encrypted) user fields to build the FHIR resource.
    const patient = await prisma.patient.findFirst({
      where: { id: parsed.data.patientId, deletedAt: null },
      select: {
        id: true,
        user: {
          select: { firstname: true, lastname: true, birthday: true },
        },
      },
    })
    if (!patient) return NextResponse.json({ error: "notFound" }, { status: 404 })

    const systemUrl = process.env.FHIR_PATIENT_SYSTEM_URL ?? "urn:diabeo:patient"
    const resource = buildFhirPatient({
      internalId: patient.id,
      systemUrl,
      firstname: safeDecryptField(patient.user.firstname),
      lastname: safeDecryptField(patient.user.lastname),
      birthday: patient.user.birthday ?? null,
    })

    const out = await fhirInteropService.enqueue(
      {
        patientId: parsed.data.patientId,
        resourceType: "Patient",
        externalSystemUrl: parsed.data.externalSystemUrl,
        resource,
      },
      user.id, ctx,
    )

    return NextResponse.json(
      { ...out, scaffoldMode: !fhirInteropService.isEnabled() },
      { status: 201 },
    )
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "interop/fhir/push POST", ctx.requestId)
  }
}
