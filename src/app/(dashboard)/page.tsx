/**
 * Dashboard root redirect — role-based.
 *
 *  - DOCTOR → `/medecin` (Groupe 9b Batch 1, US-2400)
 *  - NURSE  → `/infirmier` (Groupe 9b Batch 2, US-2405)
 *  - ADMIN  → `/admin` (Groupe 9b Batch 3, US-2410)
 *  - VIEWER → handled by `(dashboard)/layout.tsx` → `/patient/dashboard`
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
      redirect("/medecin")
    case "NURSE":
      redirect("/infirmier")
    case "ADMIN":
      redirect("/admin")
    case "VIEWER":
      redirect("/patient/dashboard")
    default:
      redirect("/login")
  }
}
