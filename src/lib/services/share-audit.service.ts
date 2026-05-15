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

// H1 (re-review) — bumped from 100 to 500 and moved the kind filter to
//   SQL so a busy patient's audit history doesn't drown share events.
const SHARE_AUDIT_LIMIT = 500

/**
 * Kinds d'audit liés aux partages tiers, queryés sur metadata.kind.
 * H2 (re-review) : `mode.validate` / `mode.deactivate` (legacy) remplacés
 * par les kinds dérivés du configType (`*.validate`, `*.deactivate`,
 * `*.history`) émis par `patientModeWorkflow` post-fix.
 */
const SHARE_AUDIT_KINDS = [
  "third_party_share.read",
  "third_party_share.upsert",
  "third_party_share.validate",
  "third_party_share.deactivate",
  "third_party_share.history",
  "third_party_share.snapshot.invalid",
  "shared_notifications.read",
  "shared_notifications.upsert",
  "shared_notifications.validate",
  "shared_notifications.deactivate",
  "shared_notifications.history",
  "shared_notifications.snapshot.invalid",
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
    // H1 (re-review) — kind filter pushed to SQL via Prisma OR-of-equals.
    //   Combined with the GIN partial index on `metadata.patientId`
    //   (ADR #18 / US-2268), this avoids the in-memory truncation risk.
    const rows = await prisma.auditLog.findMany({
      where: {
        metadata: { path: ["patientId"], equals: patientId },
        OR: SHARE_AUDIT_KINDS.map((kind) => ({
          metadata: { path: ["kind"], equals: kind },
        })),
      },
      orderBy: { createdAt: "desc" },
      take: SHARE_AUDIT_LIMIT,
    })

    // M4 (re-review) — emit scanned/filtered counts so forensics can detect
    //   saturation (if `scanned === SHARE_AUDIT_LIMIT` and not equal to
    //   `filtered`, the result set may be truncated — bump take or paginate).
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "AUDIT_LOG",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: {
        patientId, kind: "share_audit.read",
        scanned: rows.length,
        count: rows.length,
        truncated: rows.length >= SHARE_AUDIT_LIMIT,
      },
    })

    return rows.map((r) => ({
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
