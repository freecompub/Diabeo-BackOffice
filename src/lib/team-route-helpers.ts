/**
 * @module team-route-helpers
 * @description Shared helpers for Groupe 3 routes — typed-error → HTTP
 * mapping + RBAC role check with `accessDenied` audit emission.
 *
 * Review PR #390 :
 *  - M1 : log includes error.stack + requestId for HDS correlation.
 *  - H1 : `auditedRequireRole` emits an `accessDenied` audit row on RBAC
 *         failures so US-2265 burst detector sees them.
 *  - H6 / H7 / H9 : services raise `ForbiddenError`; here we provide the
 *    bridge to a 403 + optional audit row before responding.
 */

import { NextResponse } from "next/server"
import { AuthError, getAuthUser, requireRole, type AuthUser } from "@/lib/auth"
import type { Role } from "@prisma/client"
import {
  auditService,
  type AuditContext,
  type AuditResource,
} from "@/lib/services/audit.service"
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

/**
 * Wrapper around `requireRole` that emits an `accessDenied()` audit entry
 * when the caller is authenticated but lacks the required role. Drops the
 * 401-no-user case (no audit row possible without a userId).
 *
 * Re-throws `AuthError` so the route's outer catch (via `mapErrorToResponse`)
 * still produces the right HTTP status.
 */
export async function auditedRequireRole(
  req: Request,
  minRole: Role,
  ctx: AuditContext,
  resource: AuditResource,
  resourceId: string,
): Promise<AuthUser> {
  try {
    return requireRole(req, minRole)
  } catch (e) {
    if (e instanceof AuthError && e.status === 403) {
      const u = getAuthUser(req)
      if (u) {
        try {
          await auditService.accessDenied({
            userId: u.id,
            resource,
            resourceId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: { requiredRole: minRole },
          })
        } catch {
          // swallow — never fail the response on audit-write hiccup.
        }
      }
    }
    throw e
  }
}

/** Map any error caught at the route layer to a NextResponse. */
export function mapErrorToResponse(error: unknown, routeTag: string, requestId?: string): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message, field: error.field }, { status: 422 })
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "notFound" }, { status: 404 })
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const msg = error instanceof Error ? error.message : "Unknown error"
  const stack = error instanceof Error ? error.stack : undefined
  // eslint-disable-next-line no-console
  console.error(`[${routeTag}]`, { msg, stack, requestId })
  return NextResponse.json({ error: "serverError" }, { status: 500 })
}
