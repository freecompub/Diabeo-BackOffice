import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientId, viewerProposalSources } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  patientId: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "accepted", "rejected", "expired"]).optional(),
  parameterType: z.enum(["insulinSensitivityFactor", "insulinToCarbRatio", "basalRate"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const params = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(params)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) {
      // Sonde d'énumération (pro visant un patient hors portefeuille) → auditée (US-2265). Report US-2648a.
      if (parsed.data.patientId != null && user.role !== "VIEWER") {
        await auditService
          .accessDenied({ userId: user.id, resource: "PATIENT", resourceId: String(parsed.data.patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId: parsed.data.patientId, kind: "adjustmentProposalList" } })
          .catch(() => {})
      }
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    // Sûreté (medical, étape 1 vue unifiée) — le PATIENT (VIEWER) ne reçoit QUE ses propres demandes
    // (`source=patient`). Imposé SERVEUR (helper partagé avec `.../summary`), jamais depuis la query : voir
    // une dose non validée d'un soignant/l'algorithme l'exposerait à une auto-injection (ADR #13). Pros = tout.
    const proposals = await adjustmentService.list(patientId, { ...parsed.data, sources: viewerProposalSources(user.role) }, user.id, ctx)
    return NextResponse.json(proposals)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[adjustment-proposals GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

// US-2648a — création d'une PROPOSITION humaine (NURSE / patient / DOCTOR).
// `fixedDose` volontairement absent du SCHÉMA HTTP : câblé au niveau service (US-2652, moment +
// persistance + apply), mais son exposition à l'UI humaine est une slice ultérieure. `patientId`
// ignoré pour un VIEWER (résolu sur son propre dossier).
const createSchema = z.object({
  patientId: z.number().int().positive().optional(),
  parameterType: z.enum(["insulinSensitivityFactor", "insulinToCarbRatio", "basalRate"]),
  proposedValue: z.number().finite(),
  reason: z.enum(["patientRequested", "manualAdjustment"]),
  timeSlotStartHour: z.number().int().min(0).max(23).optional(),
  timeSlotEndHour: z.number().int().min(0).max(24).optional(),
  carbRatioSlotStart: z.number().int().min(0).max(23).optional(),
  carbRatioSlotEnd: z.number().int().min(0).max(24).optional(),
  pumpBasalSlotId: z.string().uuid().optional(),
  // US-2659 — cible d'une basale STYLO (MDI). Exclusive de `pumpBasalSlotId` (le service re-dérive le mode
  // de délivrance SERVEUR et rejette un discriminateur incohérent — `deliveryModeMismatch`).
  basalDoseKind: z.enum(["daily", "morning", "evening"]).optional(),
  // US-2659 (S3) — accusé DKA/jour-de-maladie (consentement à une baisse basale). Requis pour une baisse stylo.
  sickDayAcknowledged: z.boolean().optional(),
  proposerComment: z.string().max(1000).optional(),
}).refine((d) => !(d.basalDoseKind != null && d.pumpBasalSlotId != null), {
  message: "basalDoseKind and pumpBasalSlotId are mutually exclusive",
  path: ["basalDoseKind"],
})

/** Erreurs métier de `createProposal` → statut HTTP (codes stables, sans PHI). */
const ERROR_STATUS: Record<string, number> = {
  valueOutOfBounds: 422,
  nonInsulinNoDose: 422, // US-2651 — patient non insuliné : aucune proposition de dose (frontière MDR)
  patientDeltaTooLarge: 422,
  slotRequired: 400,
  currentValueNotFound: 404,
  duplicatePendingProposal: 409,
  patientProposalCooldown: 429, // US-2650 — cooldown anti-churn (proposition patient trop rapprochée)
  // US-2659 (S3) — baisse basale patient gatée.
  maturityTooLowForDecrease: 403, // maturité insuffisante (autorisation refusée)
  dkaAcknowledgmentRequired: 422, // accusé DKA manquant (baisse stylo)
  deliveryModeMismatch: 422, // discriminateur (stylo/pompe) incohérent avec la config serveur
  noChangeProposed: 422, // baisse infra-incrément / non délivrable → non actionnable
}

/**
 * POST /api/adjustment-proposals — créer une proposition d'ajustement (US-2648a).
 *
 * Sécurité (obligations route de US-2649a) : accès résolu par `resolvePatientId`
 * (VIEWER → SON dossier en ignorant `patientId` ; pro → `canAccessPatient`) ;
 * rôle proposeur dérivé de la SESSION (jamais du body ; ADMIN rejeté) ; la réponse
 * n'expose JAMAIS `proposerComment` (ciphertext). La primitive `createProposal`
 * dérive `currentValue` serveur, borne, anti-spam et n'applique jamais.
 */
export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    // ADMIN = rôle technique, non clinicien → ne PROPOSE pas (une proposition émane
    // d'une identité clinique patient/nurse/doctor). NB : l'écriture DIRECTE de config
    // insuline reste ouverte à ADMIN via requireRole(DOCTOR, hiérarchique) — c'est le
    // bypass PHI V1 ASSUMÉ (cf. access-control.ts, levé en V4/F1), pas une incohérence.
    if (user.role === "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 })

    const ctx = extractRequestContext(req)

    // Rate-limit anti-abus (US-2652 / report US-2648a) : borne le débit create→reject→recreate et le volume
    // multi-slots que l'index partiel `one_pending_per_slot` ne couvre pas. Fail-open ; saturation auditée.
    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.insulinSubmission)
    if (!rl.allowed) {
      await auditService
        .rateLimited({ userId: user.id, resource: "PATIENT", resourceId: "adjustment-proposal", ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { surface: "api", kind: "adjustmentProposalCreate" } })
        .catch(() => {})
      return NextResponse.json({ error: "rateLimitExceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } })
    }

    const body: unknown = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    // Accès : VIEWER → son propre dossier (ignore body.patientId) ; pro → canAccessPatient.
    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) {
      // Un pro qui vise un patient hors portefeuille (patientId fourni → null) = sonde d'énumération :
      // auditée (accessDenied, burst-detection US-2265). Report US-2648a.
      if (parsed.data.patientId != null && user.role !== "VIEWER") {
        await auditService
          .accessDenied({ userId: user.id, resource: "PATIENT", resourceId: String(parsed.data.patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId: parsed.data.patientId, kind: "adjustmentProposalCreate" } })
          .catch(() => {})
      }
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    // Rôle proposeur dérivé de la session (anti-usurpation) — jamais du body.
    const proposerRole = user.role === "DOCTOR" ? "doctor" : user.role === "NURSE" ? "nurse" : "patient"

    const { patientId: _pid, ...input } = parsed.data
    const proposal = await adjustmentService.createProposal(
      { patientId, ...input },
      { userId: user.id, role: proposerRole },
      ctx,
    )

    // Ne JAMAIS renvoyer le ciphertext `proposerComment` au client (CLAUDE.md).
    const { proposerComment: _c, ...dto } = proposal
    return NextResponse.json(dto, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    const status = ERROR_STATUS[msg]
    if (status) return NextResponse.json({ error: msg }, { status })
    console.error("[adjustment-proposals POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
