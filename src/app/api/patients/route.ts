import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError, checkRateLimit, recordFailedAttempt } from "@/lib/auth"
import {
  patientService,
  PatientCreationError,
} from "@/lib/services/patient.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
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

/**
 * Body schema for patient creation. Mirrors the `/patients/new` wizard.
 * `email` is normalised (trim + lowercase) so emailHmac lookups are stable.
 * Upper bounds on year fields are evaluated at parse time (`new Date()` inside
 * the refine) so a long-running process never rejects a valid next-year value
 * after a New Year's Eve without a restart.
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
  yearDiag: z.number().int().min(1900)
    .refine((v) => v <= new Date().getFullYear(), { message: "yearDiag in the future" })
    .optional(),
})

/** Per-actor key throttling the email-existence conflict path (anti-enumeration). */
const conflictRateKey = (userId: number) => `patient-create-conflict:${userId}`

/**
 * POST /api/patients — create a new patient AND its backing User account.
 *
 * RBAC: NURSE+ (NURSE, DOCTOR, ADMIN). Encrypts PII, enforces unique email via
 * emailHmac, audits CREATE USER + CREATE PATIENT, then best-effort sends an
 * invitation (set-password) email. The mobile QR invite stays available via
 * `POST /api/patients/[id]/invite` (US-2025).
 */
export async function POST(req: NextRequest) {
  let actorId: number | undefined
  try {
    const user = requireRole(req, "NURSE")
    actorId = user.id

    // Anti-enumeration: if this actor has tripped the email-existence conflict
    // limiter (repeated `emailExists` probes), short-circuit with 429 before
    // doing any work. Successful creations never feed this counter, so legit
    // bulk patient creation is unaffected.
    const rl = await checkRateLimit(conflictRateKey(user.id))
    if (rl.blocked) {
      return NextResponse.json(
        { error: "tooManyAttempts", retryAfter: rl.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds ?? 60) } },
      )
    }

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
      // `emailExists` reveals account existence (cross-tenant) — count it toward
      // the anti-enumeration limiter and audit the conflict for burst detection
      // (US-2265 spirit). No PII (no email) in the audit metadata.
      if (error.code === "emailExists" && actorId !== undefined) {
        await recordFailedAttempt(conflictRateKey(actorId))
        await auditService.log({
          userId: actorId,
          action: "READ",
          resource: "USER",
          metadata: { kind: "patient.create.email_conflict" },
          ...extractRequestContext(req),
        }).catch(() => {})
      }
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    logger.error("api/patients", "POST failed", { userId: actorId }, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
