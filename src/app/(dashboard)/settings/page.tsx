/**
 * Settings route — Server Component wrapper (#475 §7).
 *
 * Reads the authenticated user's role from the `x-user-role` request header
 * injected by the JWT middleware (`src/middleware.ts`, matcher `/settings/:path*`)
 * and passes it to the client form, which gates patient-only sections
 * (medicalData / administrative / dayMoments / privacy) so they never render for
 * a healthcare professional (NURSE / DOCTOR / ADMIN). No extra round-trip — the
 * role is already in the JWT verified by the middleware.
 */
import { headers } from "next/headers"
import type { Role } from "@prisma/client"
import { SettingsClient } from "./SettingsClient"

const VALID_ROLES: ReadonlySet<Role> = new Set<Role>(["ADMIN", "DOCTOR", "NURSE", "VIEWER"])

export default async function SettingsPage() {
  const headerRole = (await headers()).get("x-user-role")
  // Fail safe: an unknown/missing role is treated as VIEWER (most restrictive
  // surface visible = patient sections); the middleware already guarantees auth.
  const role: Role = headerRole && VALID_ROLES.has(headerRole as Role)
    ? (headerRole as Role)
    : "VIEWER"

  return <SettingsClient role={role} />
}
