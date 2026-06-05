/**
 * Settings route — Server Component wrapper (#475 §7).
 *
 * Reads the authenticated user's role from the `x-user-role` request header
 * injected by the JWT middleware (`src/middleware.ts`, matcher `/settings/:path*`)
 * and passes it to the client form, which gates patient-only sections
 * (medicalData / administrative / dayMoments / privacy) so they never render for
 * a healthcare professional (NURSE / DOCTOR / ADMIN). No extra round-trip — the
 * role is already in the JWT verified by the middleware.
 *
 * Note: the parent `(dashboard)/layout.tsx` already redirects an invalid/missing
 * role to /login and a VIEWER to /patient/dashboard, so in practice only a valid
 * PS role reaches here. We still fail closed (redirect, not a silent default) to
 * keep the page honest on its own.
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import type { Role } from "@prisma/client"
import { SettingsClient } from "./SettingsClient"

const VALID_ROLES: ReadonlySet<Role> = new Set<Role>(["ADMIN", "DOCTOR", "NURSE", "VIEWER"])

export default async function SettingsPage() {
  const headerRole = (await headers()).get("x-user-role")
  // Fail closed: an absent/unknown role means the middleware plumbing is broken
  // (this route is behind the JWT middleware) — bounce to login rather than
  // silently defaulting a role (consistent with (dashboard)/layout.tsx).
  if (!headerRole || !VALID_ROLES.has(headerRole as Role)) {
    redirect("/login")
  }

  return <SettingsClient role={headerRole as Role} />
}
