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
import { hasManagementCapability } from "@/lib/capabilities"
import { getCurrentUserDisplayName } from "@/lib/auth/current-user-name"

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

  // US-2606 — capacité de gestion cabinet (Q2) résolue **serveur** : le bloc
  // « Gestion » de la sidebar n'est rendu que si l'utilisateur a `canManage`
  // sur ≥ 1 service (absent du DOM sinon, jamais masqué CSS). Orthogonal au
  // rôle clinique. `x-user-id` injecté par le middleware JWT.
  const rawUserId = headersList.get("x-user-id")
  const userId = rawUserId ? Number(rawUserId) : NaN
  const hasUserId = Number.isInteger(userId) && userId > 0

  // US-26xx — nom affiché dans le shell (avatar/initiales). Lookup léger,
  // non-audité, request-cached (cf. getCurrentUserDisplayName) → dédupliqué
  // avec un éventuel appel côté page. Parallélisé avec la capacité de gestion.
  const [canManageOrg, displayName] = await Promise.all([
    hasUserId ? hasManagementCapability(userId) : Promise.resolve(false),
    hasUserId ? getCurrentUserDisplayName(userId) : Promise.resolve(null),
  ])
  const userName =
    [displayName?.firstname, displayName?.lastname].filter(Boolean).join(" ") ||
    undefined

  return (
    // US-2018b — le provider enveloppe tout le shell : la consultation rend la
    // sidebar/le header inertes et monte le drawer patient par-dessus.
    <ConsultationProvider>
      <NavigationShell
        pageTitle="Diabeo"
        userRole={userRole}
        userName={userName}
        canManageOrg={canManageOrg}
      >
        {children}
      </NavigationShell>
    </ConsultationProvider>
  )
}
