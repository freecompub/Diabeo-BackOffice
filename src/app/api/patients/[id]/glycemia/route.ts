import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientShareConsent } from "@/lib/consent"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { decimalToNumber } from "@/lib/db/decimal"
import type { GlycemiaEntry } from "@prisma/client"

type RouteParams = { params: Promise<{ id: string }> }

const listQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((d) => d.from < d.to, { message: "from must be before to" })

const measurementFields = [
  "glycemiaGl", "glycemiaMgdl", "weight", "hba1c", "ketones",
  "bpSystolic", "bpDiastolic", "bolus", "basal", "carb",
] as const

const glycemiaSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  glycemiaGl: z.number().min(0.20).max(6.00).optional(),
  glycemiaMgdl: z.number().min(20).max(600).optional(),
  weight: z.number().min(20).max(300).optional(),
  hba1c: z.number().min(4.0).max(14.0).optional(),
  ketones: z.number().min(0).max(20).optional(),
  bpSystolic: z.number().int().min(50).max(300).optional(),
  bpDiastolic: z.number().int().min(20).max(200).optional(),
  bolus: z.number().min(0).max(25).optional(),
  basal: z.number().min(0).max(10).optional(),
  carb: z.number().int().min(0).max(500).optional(),
  comment: z.string().max(500).optional(),
}).refine(
  (v) => measurementFields.some((k) => v[k] !== undefined),
  { message: "atLeastOneMeasurementRequired" },
)

type SerializedGlycemiaEntry = Omit<
  GlycemiaEntry,
  "glycemiaGl" | "glycemiaMgdl" | "weight" | "hba1c" | "ketones" | "bolus" | "bolusCorr" | "basal"
> & {
  glycemiaGl: number | null
  glycemiaMgdl: number | null
  weight: number | null
  hba1c: number | null
  ketones: number | null
  bolus: number | null
  bolusCorr: number | null
  basal: number | null
  mealDescription: string | null
}

/**
 * Type-preserving serialization of a `GlycemiaEntry` for JSON response:
 *  - Decimal fields are coerced via `decimalToNumber` (no double-cast through
 *    `Record<string, unknown>`).
 *  - `mealDescription` ciphertext is decrypted (never leak base64).
 */
function serializeEntry(entry: GlycemiaEntry): SerializedGlycemiaEntry {
  return {
    ...entry,
    glycemiaGl: entry.glycemiaGl === null ? null : decimalToNumber(entry.glycemiaGl),
    glycemiaMgdl: entry.glycemiaMgdl === null ? null : decimalToNumber(entry.glycemiaMgdl),
    weight: entry.weight === null ? null : decimalToNumber(entry.weight),
    hba1c: entry.hba1c === null ? null : decimalToNumber(entry.hba1c),
    ketones: entry.ketones === null ? null : decimalToNumber(entry.ketones),
    bolus: entry.bolus === null ? null : decimalToNumber(entry.bolus),
    bolusCorr: entry.bolusCorr === null ? null : decimalToNumber(entry.bolusCorr),
    basal: entry.basal === null ? null : decimalToNumber(entry.basal),
    mealDescription: entry.mealDescription === null
      ? null
      : safeDecryptField(entry.mealDescription),
  }
}

/**
 * GET /api/patients/:id/glycemia?from=&to= — BGM/capillary entries list.
 *
 * US-2032 — Glycémies capillaires. Decrypts `mealDescription` server-side
 * before returning. Rate-limited via `patientDataRead`. Enforces patient's
 * own `gdprConsent` + `shareWithProviders` flags via `patientShareConsent`.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireAuth(req)
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const ctx = extractRequestContext(req)

    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.patientDataRead)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      )
    }

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "GLYCEMIA_ENTRY", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const consent = await patientShareConsent(patientId)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error }, { status: consent.status })
    }

    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const entries = await glycemiaService.getGlycemiaEntries(
      patientId, parsed.data.from, parsed.data.to, user.id, ctx,
    )
    // Le service retourne déjà un DTO sérialisé (Decimal → number, Date → ISO).
    // On déchiffre uniquement `mealDescription` (chiffré AES-256-GCM en base
    // pour la confidentialité PII — ne doit JAMAIS sortir en base64 brut).
    return NextResponse.json(
      entries.map((e) => ({
        ...e,
        mealDescription: e.mealDescription === null ? null : safeDecryptField(e.mealDescription),
      })),
    )
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/glycemia GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/** POST /api/patients/:id/glycemia — professional glycemia entry */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const ctx = extractRequestContext(req)

    // Parity with GET — pro caller must have accepted the GDPR policy too.
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "GLYCEMIA_ENTRY", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const consent = await patientShareConsent(patientId)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error }, { status: consent.status })
    }

    const body = await req.json()
    const parsed = glycemiaSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.glycemiaEntry.create({
        data: {
          patientId,
          isProfessional: true,
          date: new Date(parsed.data.date),
          time: parsed.data.time ? new Date(`1970-01-01T${parsed.data.time}:00Z`) : null,
          glycemiaGl: parsed.data.glycemiaGl,
          glycemiaMgdl: parsed.data.glycemiaMgdl,
          weight: parsed.data.weight,
          hba1c: parsed.data.hba1c,
          ketones: parsed.data.ketones,
          bpSystolic: parsed.data.bpSystolic,
          bpDiastolic: parsed.data.bpDiastolic,
          bolus: parsed.data.bolus,
          basal: parsed.data.basal,
          carb: parsed.data.carb,
          mealDescription: parsed.data.comment ? encryptField(parsed.data.comment) : null,
        },
      })

      await auditService.logWithTx(tx, {
        userId: user.id,
        action: "CREATE",
        resource: "GLYCEMIA_ENTRY",
        resourceId: String(created.id),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { patientId, isProfessional: true },
      })

      return created
    })

    return NextResponse.json(serializeEntry(entry), { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/glycemia POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
