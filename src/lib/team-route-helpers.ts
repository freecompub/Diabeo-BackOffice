/**
 * @module team-route-helpers
 * @description Shared helpers for Groupe 3 routes — typed-error → HTTP
 * mapping + Zod validation shortcut. Reduces boilerplate across 10+ routes.
 */

import { NextResponse } from "next/server"
import { AuthError } from "@/lib/auth"
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

/** Map any error caught at the route layer to a NextResponse. */
export function mapErrorToResponse(error: unknown, routeTag: string): NextResponse {
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
  // eslint-disable-next-line no-console
  console.error(`[${routeTag}]`, msg)
  return NextResponse.json({ error: "serverError" }, { status: 500 })
}
