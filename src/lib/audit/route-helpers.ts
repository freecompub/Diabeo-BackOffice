/**
 * @module audit/route-helpers
 * @description Thin route-side helpers that wrap auditService calls so a
 * transient audit-write failure cannot turn a legitimate 403 into a 500.
 *
 * Pattern enforced: when `canAccessPatient` returns false on a *real* (loaded)
 * resource, the route invokes {@link auditForbiddenInRoute} and then returns
 * 403. Audit failures are logged, never thrown — preserving the route's
 * intended response and timing characteristics.
 */

import { auditService } from "@/lib/services/audit.service"
import type { AuditContext, AuditResource } from "@/lib/services/audit.service"
import type { AuthUser } from "@/lib/auth"
import type { Prisma } from "@prisma/client"
import { logger } from "@/lib/logger"

interface ForbiddenAuditInput {
  user: AuthUser
  resource: AuditResource
  resourceId: string
  ctx: AuditContext
  metadata?: Prisma.InputJsonValue
}

/**
 * Record a forbidden-access attempt (US-2265) without ever throwing. If the
 * audit DB is momentarily unavailable, the breach is logged via the project
 * logger and the route still returns 403 — preferring data-loss over leaking
 * timing information by serving a 500 instead.
 *
 * Use this only after confirming the resource exists (`loadForAccessCheck`,
 * etc.) — we must not create an existence oracle for unknown IDs.
 */
export async function auditForbiddenInRoute(input: ForbiddenAuditInput): Promise<void> {
  try {
    await auditService.accessDenied({
      userId: input.user.id,
      resource: input.resource,
      resourceId: input.resourceId,
      ipAddress: input.ctx.ipAddress,
      userAgent: input.ctx.userAgent,
      requestId: input.ctx.requestId,
      metadata: input.metadata,
    })
  } catch (err) {
    logger.error("audit", "accessDenied write failed", {}, err)
  }
}
