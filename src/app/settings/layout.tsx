/**
 * Settings layout — shared across all roles (US-3356 extension).
 *
 * Unlike the pro `(dashboard)` layout (which bounces VIEWER to /patient/dashboard)
 * and the patient `(patient)` layout (which bounces non-VIEWER to their role home),
 * /settings is the single page accessible to every authenticated role.
 *
 * The server component reads `x-user-role` from the JWT middleware and selects
 * the appropriate NavigationShell variant so the sidebar stays coherent with
 * the user's role context.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { NavigationShell } from "@/components/diabeo/NavigationShell"
import { isKnownRoleString } from "@/lib/auth/role-home"

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const rawRole = headersList.get("x-user-role")

  if (!isKnownRoleString(rawRole)) {
    redirect("/login")
  }

  const t = await getTranslations("nav")

  return (
    <NavigationShell
      pageTitle={t("settings")}
      userRole={rawRole}
      variant={rawRole === "VIEWER" ? "patient" : "pro"}
    >
      {children}
    </NavigationShell>
  )
}
