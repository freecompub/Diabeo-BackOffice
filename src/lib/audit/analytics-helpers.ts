/**
 * @module audit/analytics-helpers
 * @description Failed-access audit helpers for analytics routes.
 *
 * Two distinct paths, mapped to different audit primitives:
 *
 *  - `auditAnalyticsAccessDenied` for RBAC failures (401/403). Routes UNAUTHORIZED
 *    through `auditService.accessDenied()` so US-2265 burst-detection (50+
 *    UNAUTHORIZED in 60s by the same user) actually sees them.
 *
 *  - `auditAnalyticsFailure` for non-RBAC failures (429 rate-limit,
 *    413 populationTooLarge, 404 patient-not-found, validation). Uses
 *    `auditService.log()` with a non-UNAUTHORIZED action so it does NOT poison
 *    burst-detection forensics with false positives.
 *
 * Audit-write failures are swallowed (logger only) — never crash the route.
 */

import { auditService } from "@/lib/services/audit.service"
import type { AuditAction, AuditContext, AuditResource } from "@/lib/services/audit.service"
import type { AuthUser } from "@/lib/auth"
import type { Prisma } from "@prisma/client"
import { logger } from "@/lib/logger"

interface DeniedInput {
  user: AuthUser
  ctx: AuditContext
  resource?: AuditResource
  resourceId: string
  metadata?: Record<string, Prisma.InputJsonValue>
}

interface FailureInput {
  user: AuthUser
  ctx: AuditContext
  resource?: AuditResource
  resourceId: string
  reason: string
  /** Non-UNAUTHORIZED action — RATE_LIMITED, IMPORT, etc. UNAUTHORIZED goes through accessDenied. */
  action: Exclude<AuditAction, "UNAUTHORIZED" | "RBAC_BREACH_BURST">
  metadata?: Record<string, Prisma.InputJsonValue>
}

/**
 * Record an RBAC denial. Routes the entry through `auditService.accessDenied`
 * so the burst detector sees it.
 */
export async function auditAnalyticsAccessDenied(input: DeniedInput): Promise<void> {
  try {
    await auditService.accessDenied({
      userId: input.user.id,
      resource: input.resource ?? "ANALYTICS",
      resourceId: input.resourceId,
      ipAddress: input.ctx.ipAddress,
      userAgent: input.ctx.userAgent,
      requestId: input.ctx.requestId,
      metadata: input.metadata,
    })
  } catch (err) {
    logger.error("audit", "analytics accessDenied write failed", {}, err)
  }
}

/**
 * Record a non-RBAC failure (rate-limit, resource cap, validation, etc.).
 * Caller passes an explicit `action` so we never accidentally inflate the
 * UNAUTHORIZED counter US-2265 watches.
 */
export async function auditAnalyticsFailure(input: FailureInput): Promise<void> {
  try {
    await auditService.log({
      userId: input.user.id,
      action: input.action,
      resource: input.resource ?? "ANALYTICS",
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
