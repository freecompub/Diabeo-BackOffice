/**
 * GET /api/slot-set-proposals — liste les **propositions d'ENSEMBLE de créneaux** (`SlotSetProposal`) d'un
 * patient (US-2657 slice C3d). Vue médecin de revue ; un patient (VIEWER) voit ses propres propositions.
 *
 * Accès résolu par `resolvePatientId` (VIEWER → propre dossier ; pro → `patientId` explicite + portefeuille,
 * anti-IDOR → 404 neutre). Consentement RGPD requis. Lecture santé (valeurs de config) → auditée par le service.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { slotSetProposalService, type ProposedSlot } from "@/lib/services/slot-set-proposal.service"
import { SLOT_SET_ERROR_STATUS } from "@/lib/insulin/slot-set-errors"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

const querySchema = z.object({
  patientId: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "accepted", "rejected", "expired", "superseded"]).optional(),
})

/**
 * US-2663 (S4) — corps de création GROUPÉE PRO (nurse/doctor). `proposedSlots` est un tableau brut (la FORME
 * par levier est re-validée par `createSetProposal` → `parseSlots`/`assertValidGroupedSet`, source de vérité —
 * un jeu mal formé lève `invalidSlotSet`/`valueOutOfBounds`, mappés 4xx). `.min(1).max(24)` = garde anti-abus.
 * Pas de `sickDayAcknowledged` : les pros ne sont PAS gatés (cliniciens qualifiés — cf. `evaluatePatientGroupedGate`).
 */
const createSchema = z.object({
  patientId: z.number().int().positive().optional(),
  parameterType: z.enum(["insulinSensitivityFactor", "insulinToCarbRatio", "basalRate", "fixedDose"]),
  proposedSlots: z.array(z.record(z.string(), z.unknown())).min(1).max(24),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const ctx = extractRequestContext(req)

    // Rate-limit anti-abus : borne le spam de liste (bruit d'audit / charge DB) + le sondage d'ids. Fail-open.
    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.insulinReview)
    if (!rl.allowed) {
      await auditService
        .rateLimited({ userId: user.id, resource: "SLOT_SET_PROPOSAL", resourceId: "list", ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { surface: "api", kind: "slotSetProposalList" } })
        .catch(() => {})
      return NextResponse.json({ error: "rateLimitExceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } })
    }

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) {
      // Un pro qui fournit un `patientId` hors périmètre est refusé par `resolvePatientId` (null) → sonde
      // d'énumération auditée (burst-detection US-2265). Le cas VIEWER/param absent ne déclenche pas d'audit.
      if (parsed.data.patientId != null) {
        await auditService
          .accessDenied({ userId: user.id, resource: "SLOT_SET_PROPOSAL", resourceId: String(parsed.data.patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId: parsed.data.patientId, kind: "slotSetProposalList" } })
          .catch(() => {})
      }
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const proposals = await slotSetProposalService.listSetProposals(patientId, user.id, parsed.data.status, ctx)
    return NextResponse.json(proposals)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error("slot-set-proposals/list", "List failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/**
 * POST /api/slot-set-proposals — **CRÉATION MANUELLE GROUPÉE PRO** (US-2663 S4). Un soignant (NURSE / DOCTOR)
 * soumet une disposition mono-paramètre entière → **proposition d'ensemble** (`SlotSetProposal` pending),
 * revue MÉDECIN (jamais auto-appliquée, ADR #13). Remplace la voie par-valeur `POST /api/adjustment-proposals`
 * pour les pros (retrait `InsulinProposalDialog`).
 *
 * Sécurité : provenance `source` DÉRIVÉE de la SESSION (ADR #27, jamais du body) — `DOCTOR`→`doctor`,
 * `NURSE`→`nurse`. **ADMIN** (technique) et **VIEWER** (= patient, voie dédiée `PUT /api/patient/insulin-slot-set`)
 * REFUSÉS (403). Accès patient via `resolvePatientId` (portefeuille, anti-IDOR → 404 neutre + sonde auditée).
 * Consentement RGPD + rate-limit anti-abus. Bornes cliniques + frontière MDR re-validées par `createSetProposal`.
 * Les pros ne sont PAS gatés (pas d'accusé DKA — cliniciens qualifiés).
 */
export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    // Seuls les soignants proposent en groupé ici. ADMIN = rôle technique (non clinicien) ; VIEWER = patient
    // (sa voie est `PUT /api/patient/insulin-slot-set`, own-id strict). Parité `POST /api/adjustment-proposals`.
    if (user.role === "ADMIN" || user.role === "VIEWER") return NextResponse.json({ error: "forbidden" }, { status: 403 })
    const ctx = extractRequestContext(req)

    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.insulinSubmission)
    if (!rl.allowed) {
      await auditService
        .rateLimited({ userId: user.id, resource: "SLOT_SET_PROPOSAL", resourceId: "create", ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { surface: "api", kind: "slotSetProposalCreate" } })
        .catch(() => {})
      return NextResponse.json({ error: "rateLimitExceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } })
    }

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) {
      if (parsed.data.patientId != null) {
        await auditService
          .accessDenied({ userId: user.id, resource: "SLOT_SET_PROPOSAL", resourceId: String(parsed.data.patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId: parsed.data.patientId, kind: "slotSetProposalCreate" } })
          .catch(() => {})
      }
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    // Provenance dérivée de la session (anti-usurpation) — jamais du body. NURSE/DOCTOR uniquement (ADMIN/VIEWER
    // déjà refusés). `createSetProposal` valide la forme + bornes + MDR, supersède le pending humain, audite.
    const source = user.role === "DOCTOR" ? "doctor" : "nurse"
    try {
      const { id } = await slotSetProposalService.createSetProposal({
        patientId,
        parameterType: parsed.data.parameterType,
        proposedSlots: parsed.data.proposedSlots as ProposedSlot[], // forme re-validée par le service (autorité)
        proposer: { userId: user.id, source },
        ctx,
      })
      return NextResponse.json({ outcome: "proposal", proposalId: id }, { status: 201 })
    } catch (e) {
      const reason = e instanceof Error ? e.message : "unknown"
      const status = SLOT_SET_ERROR_STATUS[reason] ?? (reason === "patientNotFound" ? 404 : undefined)
      if (status) {
        await auditService
          .log({ userId: user.id, action: "INSULIN_SLOT_SUBMISSION", resource: "PATIENT", resourceId: String(patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId, parameterType: parsed.data.parameterType, source, outcome: "rejected", reason } })
          .catch(() => {})
        return NextResponse.json({ error: reason }, { status })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error("slot-set-proposals/create", "Create failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
