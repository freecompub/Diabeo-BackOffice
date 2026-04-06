/**
 * Guard that ensures a route/service only runs in staging environment.
 * Returns a 404 response in production to hide the route entirely.
 */

import { NextResponse } from "next/server"

export function isStagingEnv(): boolean {
  return process.env.APP_ENV === "staging"
}

export function stagingOnlyResponse(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
