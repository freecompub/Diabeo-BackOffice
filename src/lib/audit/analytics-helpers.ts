/**
 * @module audit/analytics-helpers
 * @description Shared failed-access audit helpers for analytics routes. Used
 * by every new analytics endpoint to record 401/403/404/429 attempts so HDS
 * forensic queries (US-2265) can spot RBAC-breach bursts.
 *
 * Failures of the audit write itself are swallowed (logger only) — never
 * leak through as 500 to the caller.
 */

import { auditService } from "@/lib/services/audit.service"
import type { AuditAction, AuditContext } from "@/lib/services/audit.service"
import type { AuthUser } from "@/lib/auth"
import type { Prisma } from "@prisma/client"
import { logger } from "@/lib/logger"

export async function auditAnalyticsFailure(input: {
  user: AuthUser
  ctx: AuditContext
  resourceId: string
  reason: string
  action?: AuditAction
  metadata?: Record<string, Prisma.InputJsonValue>
}): Promise<void> {
  try {
    await auditService.log({
      userId: input.user.id,
      action: input.action ?? "UNAUTHORIZED",
      resource: "ANALYTICS",
      resourceId: input.resourceId,
      ipAddress: input.ctx.ipAddress,
      userAgent: input.ctx.userAgent,
      requestId: input.ctx.requestId,
      metadata: { ...(input.metadata ?? {}), reason: input.reason },
    })
  } catch (err) {
    logger.error("audit", "analytics failure write failed", {}, err)
  }
}
