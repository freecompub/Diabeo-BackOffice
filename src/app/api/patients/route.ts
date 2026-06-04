import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import {
  patientService,
  PatientCreationError,
} from "@/lib/services/patient.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { emailService } from "@/lib/services/email.service"
import { assertJsonContentType, assertBodySize } from "@/lib/team-route-helpers"
import { logger } from "@/lib/logger"

/** GET /api/patients — list patients for the connected healthcare pro */
export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const patients = await patientService.listByDoctor(user.id, user.id)
    return NextResponse.json(patients)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const currentYear = new Date().getFullYear()

/**
 * Body schema for patient creation. Mirrors the `/patients/new` wizard.
 * `email` is normalised (trim + lowercase) so emailHmac lookups are stable.
 */
const createPatientSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  sex: z.enum(["M", "F", "X"]).optional(),
  birthday: z.coerce
    .date()
    .refine((d) => d.getFullYear() >= 1900 && d <= new Date(), {
      message: "birthday out of range",
    })
    .optional(),
  pathology: z.enum(["DT1", "DT2", "GD"]),
  yearDiag: z.number().int().min(1900).max(currentYear).optional(),
})

/**
 * POST /api/patients — create a new patient AND its backing User account.
 *
 * RBAC: NURSE+ (NURSE, DOCTOR, ADMIN). Encrypts PII, enforces unique email via
 * emailHmac, audits CREATE USER + CREATE PATIENT, then best-effort sends an
 * invitation (set-password) email. The mobile QR invite stays available via
 * `POST /api/patients/[id]/invite` (US-2025).
 */
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")

    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const sizeErr = assertBodySize(req, 16 * 1024) // 16KB — small identity payload
    if (sizeErr) return sizeErr

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const parsed = createPatientSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { email, birthday, ...rest } = parsed.data
    const ctx = extractRequestContext(req)

    const result = await patientService.createWithNewUser(
      {
        email,
        ...rest,
        ...(birthday && { birthday: birthday.toISOString().slice(0, 10) }),
      },
      user.id,
      ctx,
    )

    // Best-effort invitation email (set-password link). A delivery failure must
    // NOT roll back the created patient — the pro can re-trigger a reset later.
    emailService.sendPasswordReset(email, result.resetToken).catch((err) => {
      logger.error("api/patients", "Invitation email failed", { patientId: result.id }, err)
    })

    return NextResponse.json(
      { id: result.id, pathology: result.pathology },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof PatientCreationError) {
      // Only known, non-leaky business code is `emailExists` (409 Conflict).
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
