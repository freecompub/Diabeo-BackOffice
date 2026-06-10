/**
 * Dashboard layout — NavigationShell wraps all protected pages.
 *
 * Server component that reads user identity from JWT middleware headers
 * (x-user-id, x-user-role) and passes them to the client NavigationShell.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { NavigationShell, type UserRole } from "@/components/diabeo/NavigationShell"
import { ConsultationProvider } from "@/components/diabeo/consultation/ConsultationContext"

const VALID_ROLES: UserRole[] = ["ADMIN", "DOCTOR", "NURSE", "VIEWER"]

function isValidRole(role: string | null): role is UserRole {
  return role !== null && VALID_ROLES.includes(role as UserRole)
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const rawRole = headersList.get("x-user-role")

  // L2 (re-review) — fail-safe : missing/invalid role header bounces to
  // login rather than defaulting to VIEWER and granting access.
  if (!isValidRole(rawRole)) {
    redirect("/login")
  }
  const userRole: UserRole = rawRole

  // US-3356 — Symmetry with (patient)/layout : VIEWER hitting the pro
  // dashboard is bounced to the patient self-service area. Handles the
  // fallback case where the login redirect couldn't determine the role.
  if (userRole === "VIEWER") {
    redirect("/patient/dashboard")
  }

  return (
    // US-2018b — le provider enveloppe tout le shell : la consultation rend la
    // sidebar/le header inertes et monte le drawer patient par-dessus.
    <ConsultationProvider>
      <NavigationShell
        pageTitle="Diabeo"
        userRole={userRole}
      >
        {children}
      </NavigationShell>
    </ConsultationProvider>
  )
}
