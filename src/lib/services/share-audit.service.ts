/**
 * @module share-audit.service
 * @description Groupe 10 Batch D — US-2239 audit partages temporaires.
 *
 * Liste les événements audit (création / validation / désactivation) liés
 * aux configurations de partage d'un patient (third_party_share). Pure
 * query AuditLog : aucune nouvelle table, aucune nouvelle migration.
 *
 * RBAC : DOCTOR+ minimum. ADMIN export possible via metadata.
 */

import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"

export type ShareAuditEvent = {
  id: string
  userId: number | null
  action: string
  resource: string
  resourceId: string | null
  createdAt: Date
  metadata: Record<string, unknown>
}

const SHARE_AUDIT_LIMIT = 100

/** Kinds d'audit liés aux partages tiers, queryés sur metadata.kind. */
const SHARE_AUDIT_KINDS = [
  "third_party_share.read",
  "third_party_share.upsert",
  "third_party_share.snapshot.invalid",
  "shared_notifications.read",
  "shared_notifications.upsert",
  "shared_notifications.snapshot.invalid",
  "mode.validate",          // re-use patientModeWorkflow.validate (DOCTOR sign-off)
  "mode.deactivate",
] as const

export const shareAuditQuery = {
  /**
   * Liste les audit events de partages pour un patient donné, ordrés
   * desc par createdAt. Utilise le pivot `metadata.patientId` (US-2268
   * GIN index) pour les events cross-resource.
   */
  async forPatient(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<ShareAuditEvent[]> {
    const rows = await prisma.auditLog.findMany({
      where: {
        // GIN partial index sur metadata.patientId (ADR #18 / US-2268).
        metadata: { path: ["patientId"], equals: patientId },
        AND: { metadata: { path: ["kind"], string_starts_with: "" } },
      },
      orderBy: { createdAt: "desc" },
      take: SHARE_AUDIT_LIMIT,
    })

    // Filtre in-memory sur le `kind` puisque l'égalité enum n'est pas
    // trivial en JSON path ; SHARE_AUDIT_KINDS reste petit.
    const allowedKinds = new Set<string>(SHARE_AUDIT_KINDS)
    const filtered = rows.filter((r) => {
      const meta = r.metadata as Record<string, unknown> | null
      const kind = typeof meta?.kind === "string" ? meta.kind : null
      return kind !== null && allowedKinds.has(kind)
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "AUDIT_LOG",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "share_audit.read", count: filtered.length },
    })

    return filtered.map((r) => ({
      id: r.id,
      userId: r.userId,
      action: r.action,
      resource: r.resource,
      resourceId: r.resourceId,
      createdAt: r.createdAt,
      metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    }))
  },
}
