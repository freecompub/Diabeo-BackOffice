/**
 * US-2024 — Historique des modifications (UI consumption).
 *
 * Renvoie les entrées AuditLog liées au patient (via `metadata.patientId`,
 * convention US-2268). Les valeurs sensibles `oldValue`/`newValue` ne sont
 * JAMAIS renvoyées en clair — uniquement les clés modifiées (fields list).
 * Le caller doit pouvoir accéder au patient (RBAC `canAccessPatient`).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

type RedactedRow = {
  id: string
  userId: number | null
  action: string
  resource: string
  resourceId: string | null
  createdAt: Date
  ipAddress: string | null
  userAgent: string | null
  /** Names of fields that changed (no values). */
  changedFields: string[]
}

function extractChangedFields(oldValue: unknown, newValue: unknown): string[] {
  const keys = new Set<string>()
  if (oldValue && typeof oldValue === "object") {
    for (const k of Object.keys(oldValue as Record<string, unknown>)) keys.add(k)
  }
  if (newValue && typeof newValue === "object") {
    for (const k of Object.keys(newValue as Record<string, unknown>)) keys.add(k)
  }
  return Array.from(keys).sort()
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireAuth(req)
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const ctx = extractRequestContext(req)

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

    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const rows = await auditService.getByPatient(patientId, parsed.data.limit ?? 50)
    // Redaction — never return oldValue/newValue plaintext; only field names.
    const redacted: RedactedRow[] = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      action: r.action,
      resource: r.resource,
      resourceId: r.resourceId,
      createdAt: r.createdAt,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      changedFields: extractChangedFields(r.oldValue, r.newValue),
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
