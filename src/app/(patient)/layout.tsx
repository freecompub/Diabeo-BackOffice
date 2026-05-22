/**
 * Patient self-service layout (US-3356).
 *
 * Mirrors the pro `(dashboard)` layout but renders a simpler, patient-facing
 * sidebar via `variant="patient"`. The server component reads `x-user-role`
 * from the JWT middleware to guard against non-VIEWER access. Pro roles are
 * bounced immediately to their role-specific dashboard (this layout fully
 * blocks them — the page itself does no further role guard).
 *
 * Fix RSC (#3 session 2026-05-22) : ce server component ne peut pas
 * importer / passer une `LucideIcon` au `NavigationShell` client. Les nav
 * items (avec leurs icônes) sont déclarés DANS `NavigationShell.tsx` et
 * sélectionnés ici via la prop `variant` (string sérialisable).
 *
 * Fix CRIT-2 round 2 review PR #426 — Le redirect non-VIEWER cible
 * désormais le home rôle-spécifique au lieu de `/` (cassé par
 * `src/app/page.tsx` supprimé dans CRIT-1).
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { NavigationShell } from "@/components/diabeo/NavigationShell"
import { isKnownRoleString, resolveHomeForRole } from "@/lib/auth/role-home"

export default async function PatientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const rawRole = headersList.get("x-user-role")

  // L2 (re-review) — fail-safe : missing/invalid role header bounces to login
  // rather than defaulting to VIEWER and granting patient-area access.
  if (!isKnownRoleString(rawRole)) {
    redirect("/login")
  }

  // Pro users hitting /patient/* — bounce them to their role-specific home.
  // Patient self-service routes are NOT meant for staff.
  if (rawRole !== "VIEWER") {
    redirect(resolveHomeForRole(rawRole))
  }

  return (
    <NavigationShell
      pageTitle="Diabeo"
      userRole={rawRole}
      variant="patient"
    >
      {children}
    </NavigationShell>
  )
}
