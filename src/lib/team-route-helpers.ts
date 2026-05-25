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
  // H2 (re-review C, post-merge) — Unique constraint conflict (race between
  // concurrent `nextVersion` callers, or duplicate (version_id, rank), etc.).
  // 409 lets the client retry/refresh ; field surfaced for UI debug.
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return NextResponse.json(
      { error: "uniqueConflict", target: error.meta?.target },
      { status: 409 },
    )
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
   
  console.error(`[${routeTag}]`, { msg, stack, requestId })
  return NextResponse.json({ error: "serverError" }, { status: 500 })
}

/**
 * L-RR3-4 (review re-3 PR #406) — REST hygiene : rejette les POST/
 * PUT/PATCH dont le Content-Type n'est pas `application/json`. Évite
 * d'accepter un body `text/plain` ou un form-encoded par erreur.
 *
 * `Content-Type` absent → toléré (compatibilité legacy clients).
 * `Content-Type` présent mais non-JSON → 415.
 */
export function assertJsonContentType(req: Request): NextResponse | null {
  const ct = req.headers.get("content-type")
  if (!ct) return null
  // strip params (e.g. `application/json; charset=utf-8`).
  const mediaType = ct.split(";")[0]!.trim().toLowerCase()
  if (mediaType !== "application/json") {
    return NextResponse.json(
      { error: "unsupportedMediaType", expected: "application/json" },
      { status: 415 },
    )
  }
  return null
}

/**
 * L4 (review PR #408) — Constante partagée pour le `resourceId` audit
 * des routes cohort-scoped (pas d'ID natif à pointer). Évite la
 * duplication string literal `"cohort"` et permet d'identifier ces
 * audits par regex sur `resourceId='cohort'`.
 */
export const COHORT_RESOURCE_ID = "cohort"

/**
 * H4 (review PR #407) — Garde anti-DoS : rejette les bodies déclarant
 * un `Content-Length` supérieur à `maxBytes`. Empêche `req.json()` de
 * buffer 50MB+ en mémoire avant validation Zod.
 *
 * `Content-Length` absent (HTTP/2 chunked) → toléré, mais le service
 * doit appliquer ses propres caps applicatifs (MAX_BULK_ITEMS, etc.).
 */
export function assertBodySize(
  req: Request,
  maxBytes: number,
): NextResponse | null {
  const cl = req.headers.get("content-length")
  if (!cl) return null
  const size = Number(cl)
  if (!Number.isFinite(size) || size < 0) {
    return NextResponse.json({ error: "invalidContentLength" }, { status: 400 })
  }
  if (size > maxBytes) {
    return NextResponse.json(
      { error: "payloadTooLarge", maxBytes },
      { status: 413 },
    )
  }
  return null
}
