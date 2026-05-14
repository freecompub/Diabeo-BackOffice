/**
 * @module team-route-helpers
 * @description Shared helpers for Groupe 3/5 routes — typed-error → HTTP
 * mapping + RBAC role check with `accessDenied` audit emission.
 *
 * Review PR #391 H1 : `mapErrorToResponse` now accepts an optional audit
 * context so service-layer `ForbiddenError` (e.g. `assertServiceMember`
 * failure) is recorded through `auditService.accessDenied()` — preserves
 * the US-2265 burst detector contract that was already extended to RBAC
 * 403 in PR #390.
 */

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
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
 * when the caller is authenticated but lacks the required role.
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
          // swallow
        }
      }
    }
    throw e
  }
}

export interface RouteAuditTarget {
  user: AuthUser
  ctx: AuditContext
  resource: AuditResource
  resourceId: string
  /** Optional metadata to attach to the `accessDenied` row. */
  metadata?: Record<string, unknown>
}

/**
 * Map any error caught at the route layer to a NextResponse. When called with
 * an `auditTarget`, a `ForbiddenError` will additionally emit an `accessDenied`
 * audit row (review PR #391 H1) — preserves US-2265 burst detection on
 * service-layer authorisation failures.
 */
export function mapErrorToResponse(
  error: unknown,
  routeTag: string,
  requestId?: string,
  auditTarget?: RouteAuditTarget,
): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message, field: error.field }, { status: 422 })
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "notFound" }, { status: 404 })
  }
  // H7 — Postgres serialization conflict ; client should retry the request.
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return NextResponse.json({ error: "serializationConflict" }, { status: 409 })
  }
  if (error instanceof ForbiddenError) {
    if (auditTarget) {
      // Fire-and-forget audit — never block the response.
      void auditService
        .accessDenied({
          userId: auditTarget.user.id,
          resource: auditTarget.resource,
          resourceId: auditTarget.resourceId,
          ipAddress: auditTarget.ctx.ipAddress,
          userAgent: auditTarget.ctx.userAgent,
          requestId: auditTarget.ctx.requestId,
          metadata: auditTarget.metadata as never,
        })
        .catch(() => { /* swallow */ })
    }
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const msg = error instanceof Error ? error.message : "Unknown error"
  const stack = error instanceof Error ? error.stack : undefined
  // eslint-disable-next-line no-console
  console.error(`[${routeTag}]`, { msg, stack, requestId })
  return NextResponse.json({ error: "serverError" }, { status: 500 })
}
