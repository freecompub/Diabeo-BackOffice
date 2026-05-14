/**
 * Patient self-service layout (US-3356).
 *
 * Mirrors the pro `(dashboard)` layout but renders a simpler, patient-facing
 * sidebar via `navItemsOverride`. The server component still reads
 * `x-user-role` from the JWT middleware to guard against non-VIEWER access.
 * Non-VIEWER roles fall through here (the layout doesn't block them) — the
 * `(patient)/dashboard/page.tsx` does the actual role redirect server-side
 * if a pro hits the patient route by mistake.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Home } from "lucide-react"
import {
  NavigationShell,
  type NavItem,
  type UserRole,
} from "@/components/diabeo/NavigationShell"

const VALID_ROLES: UserRole[] = ["ADMIN", "DOCTOR", "NURSE", "VIEWER"]

function isValidRole(role: string | null): role is UserRole {
  return role !== null && VALID_ROLES.includes(role as UserRole)
}

/**
 * M1 (re-review) — Batch 1 only ships the dashboard page ; nav items are
 * limited to existing routes so a click never lands on a 404. Future
 * sections (glycemia/events/appointments/profile/preferences) get added
 * here as the corresponding pages land in Batch 2+.
 */
const PATIENT_NAV_ITEMS: NavItem[] = [
  { href: "/patient/dashboard", labelKey: "patientHome", icon: Home },
]

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

  // Pro users hitting /patient/* — bounce them back to their dashboard.
  // Patient self-service routes are NOT meant for staff.
  if (userRole !== "VIEWER") {
    redirect("/dashboard")
  }

  return (
    <NavigationShell
      pageTitle="Diabeo"
      userRole={userRole}
      navItemsOverride={PATIENT_NAV_ITEMS}
    >
      {children}
    </NavigationShell>
  )
}
