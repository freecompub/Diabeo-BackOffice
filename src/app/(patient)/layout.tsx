/**
 * Patient self-service layout (US-3356).
 *
 * Mirrors the pro `(dashboard)` layout but renders a simpler, patient-facing
 * sidebar via `variant="patient"`. The server component still reads
 * `x-user-role` from the JWT middleware to guard against non-VIEWER access.
 * Non-VIEWER roles fall through here (the layout doesn't block them) — the
 * `(patient)/dashboard/page.tsx` does the actual role redirect server-side
 * if a pro hits the patient route by mistake.
 *
 * Fix RSC (#3 session 2026-05-22) : ce server component ne peut pas
 * importer / passer une `LucideIcon` au `NavigationShell` client. Les nav
 * items (avec leurs icônes) sont déclarés DANS `NavigationShell.tsx` et
 * sélectionnés ici via la prop `variant` (string sérialisable).
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import {
  NavigationShell,
  type UserRole,
} from "@/components/diabeo/NavigationShell"

const VALID_ROLES: UserRole[] = ["ADMIN", "DOCTOR", "NURSE", "VIEWER"]

function isValidRole(role: string | null): role is UserRole {
  return role !== null && VALID_ROLES.includes(role as UserRole)
}

export default async function PatientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const rawRole = headersList.get("x-user-role")

  // L2 (re-review) — fail-safe : missing/invalid role header bounces to login
  // rather than defaulting to VIEWER and granting patient-area access.
  if (!isValidRole(rawRole)) {
    redirect("/login")
  }
  const userRole: UserRole = rawRole

  // Pro users hitting /patient/* — bounce them back to the role-router (#11.b).
  // Patient self-service routes are NOT meant for staff.
  if (userRole !== "VIEWER") {
    redirect("/")
  }

  return (
    <NavigationShell
      pageTitle="Diabeo"
      userRole={userRole}
      variant="patient"
    >
      {children}
    </NavigationShell>
  )
}
