/**
 * Dashboard layout — NavigationShell wraps all protected pages.
 *
 * Server component that reads user identity from JWT middleware headers
 * (x-user-id, x-user-role) and passes them to the client NavigationShell.
 */

import { headers } from "next/headers"
import { NavigationShell, type UserRole } from "@/components/diabeo/NavigationShell"

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
  const userRole: UserRole = isValidRole(rawRole) ? rawRole : "VIEWER"

  return (
    <NavigationShell
      pageTitle="Diabeo"
      userRole={userRole}
    >
      {children}
    </NavigationShell>
  )
}
