/**
 * Settings route — Server Component wrapper (#475 §7).
 *
 * Reads the authenticated user's role from the `x-user-role` request header
 * injected by the JWT middleware (`src/middleware.ts`, matcher `/settings/:path*`)
 * and passes it to the client form, which gates patient-only sections
 * (medicalData / administrative / dayMoments / privacy) so they never render for
 * a healthcare professional (NURSE / DOCTOR / ADMIN).
 *
 * The parent `settings/layout.tsx` already validates the role and redirects
 * invalid/missing roles to /login via `isKnownRoleString`. We keep a null guard
 * + `isKnownRoleString` as defense-in-depth: if the middleware plumbing is broken
 * and the header is absent or corrupt, we bounce rather than defaulting a role.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { isKnownRoleString } from "@/lib/auth/role-home"
import { SettingsClient } from "./SettingsClient"

export default async function SettingsPage() {
  const headerRole = (await headers()).get("x-user-role")

  // Defense-in-depth: validate the role with the shared guard so the type is
  // properly narrowed (no `as` cast). The layout already does this check, but
  // keeping it here makes the page self-documenting and safe if the layout is
  // ever refactored.
  if (!isKnownRoleString(headerRole)) {
    redirect("/login")
  }

  return <SettingsClient role={headerRole} />
}
