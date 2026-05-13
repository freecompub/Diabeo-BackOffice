/**
 * US-2024 — Historique des modifications (UI consumption).
 *
 * Sécurité (post-review PR #389):
 *  - H2/H3 : route restreinte à DOCTOR+ (NURSE/VIEWER ne voient pas les
 *    IP/UA du personnel, ni les actions privilégiées comme BOLUS_CALCULATED,
 *    PROPOSAL_*, MFA_*, etc.).
 *  - H6 : pré-vérification de l'existence du patient AVANT `accessDenied()`
 *    pour éviter l'oracle d'existence et la pollution du burst detector
 *    sur les IDs scannés.
 *  - H1 : `patientShareConsent` (RGPD Art. 7.3).
 *  - M4/M5 : `changedFields` lit aussi `metadata.updatedFields` (convention
 *    repo) et filtre les noms via une allowlist.
 *  - L (typescript-pro #4) : guard `Array.isArray` ajouté.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { prisma } from "@/lib/db/client"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/** Fields a DOCTOR may see surfaced as "changed" in the patient history. */
const SAFE_FIELD_NAMES = new Set<string>([
  "pathology", "pregnancyMode", "createdAt", "deletedAt",
  // Medical-data history (already pro-readable on the detail page):
  "dt1", "size", "yearDiag", "insulin", "insulinPump",
  "tabac", "alcool", "riskWeight",
  // Objectives + treatments + insulin therapy:
  "veryLow", "low", "ok", "high", "targetGlucose", "targetMin", "targetMax",
  "sensitivityFactorGl", "sensitivityFactorMgdl", "gramsPerUnit", "basalRate",
  // Visit/appointment metadata:
  "scheduledAt", "title", "status",
])

/** Audit log actions whose names alone reveal protected workflows. */
const ACTION_HIDE_FOR_NURSE = new Set<string>([
  "MFA_SETUP_INITIATED", "MFA_ENABLED", "MFA_DISABLED", "MFA_CHALLENGE_FAILED",
  "RBAC_BREACH_BURST",
])

type RedactedRow = {
  id: string
  userId: number | null
  action: string
  resource: string
  resourceId: string | null
  createdAt: Date
  changedFields: string[]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function extractChangedFields(
  oldValue: unknown,
  newValue: unknown,
  metadata: unknown,
): string[] {
  const keys = new Set<string>()
  if (isPlainObject(oldValue)) Object.keys(oldValue).forEach((k) => keys.add(k))
  if (isPlainObject(newValue)) Object.keys(newValue).forEach((k) => keys.add(k))
  // M4 — services often write the change set in `metadata.updatedFields`.
  if (isPlainObject(metadata)) {
    const uf = (metadata as { updatedFields?: unknown }).updatedFields
    if (Array.isArray(uf)) {
      uf.forEach((k) => { if (typeof k === "string") keys.add(k) })
    }
  }
  // M5 — allowlist filter (collapse non-allowlisted names into "other").
  const filtered: string[] = []
  let hasUnknown = false
  for (const k of keys) {
    if (SAFE_FIELD_NAMES.has(k)) filtered.push(k)
    else hasUnknown = true
  }
  if (hasUnknown) filtered.push("other")
  return filtered.sort()
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    // H2/H3 — DOCTOR+ only (no patient-facing history yet — would be a
    // separate `/me/access-history` endpoint with stricter redaction).
    const user = requireRole(req, "DOCTOR")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const ctx = extractRequestContext(req)

    // H6 — pre-check patient existence BEFORE calling accessDenied() to
    // avoid the existence oracle and audit-log pollution.
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true },
    })
    if (!patient) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id,
        resource: "AUDIT_LOG",
        resourceId: String(patientId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { patientId, endpoint: "history" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    // H1 — patient consent gate.
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error }, { status: consent.status })
    }

    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const rows = await auditService.getByPatient(patientId, parsed.data.limit ?? 50)

    // H3 — drop rows that surface internal workflows (MFA, RBAC bursts).
    // Also drop ipAddress/userAgent from the redacted shape: they identify
    // the staff member's network. Caller is DOCTOR+ so seeing colleague
    // userId is acceptable.
    const redacted: RedactedRow[] = rows
      .filter((r) => !ACTION_HIDE_FOR_NURSE.has(r.action))
      .map((r) => ({
        id: r.id,
        userId: r.userId,
        action: r.action,
        resource: r.resource,
        resourceId: r.resourceId,
        createdAt: r.createdAt,
        changedFields: extractChangedFields(r.oldValue, r.newValue, r.metadata),
      }))

    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "AUDIT_LOG",
      resourceId: String(patientId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { patientId, kind: "history", count: redacted.length },
    })

    return NextResponse.json({ items: redacted })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/audit-history]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
