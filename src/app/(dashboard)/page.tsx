/**
 * Dashboard root redirect — role-based.
 *
 *  - DOCTOR / ADMIN → `/medecin` (Groupe 9b Batch 1, US-2400)
 *  - NURSE          → `/infirmier` (Groupe 9b Batch 2, US-2405)
 *  - VIEWER         → handled by `(dashboard)/layout.tsx` → `/patient/dashboard`
 *
 * Reads role from JWT middleware header (`x-user-role`) ; falls back to
 * `/login` if absent (same pattern as the layout).
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"

export default async function DashboardRootPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (!role) redirect("/login")
  switch (role) {
    case "DOCTOR":
    case "ADMIN":
      redirect("/medecin")
    case "NURSE":
      redirect("/infirmier")
    case "VIEWER":
      redirect("/patient/dashboard")
    default:
      redirect("/login")
  }
}
