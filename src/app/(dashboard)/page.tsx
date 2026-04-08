/**
 * Dashboard root redirect.
 *
 * The (dashboard) route group root redirects to /dashboard so that
 * navigating to "/" lands on the main glycemia dashboard after auth.
 */

import { redirect } from "next/navigation"

export default function DashboardRootPage() {
  redirect("/dashboard")
}
