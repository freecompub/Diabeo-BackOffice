/**
 * US-2148 — Admin gestion utilisateurs (page stub).
 *
 * #11.a session 2026-05-22 — Backend livré (PR #350 — userManagementService
 * + anti-lockout + session+JWT revocation atomique). UI dédiée non
 * encore livrée. Cette page stub évite le 404 quand un ADMIN clique
 * sur "Utilisateurs" dans la sidebar.
 *
 * À remplacer par la vraie UI quand US-2148-UI sera planifiée.
 *
 * Server-side guard : ADMIN-only.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Users } from "lucide-react"

export default async function UsersStubPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50">
        <Users className="h-8 w-8 text-teal-600" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          Gestion des utilisateurs
        </h1>
        <p className="text-sm text-muted-foreground">
          Backend opérationnel (US-2148) mais l&apos;interface d&apos;administration
          n&apos;est pas encore livrée. L&apos;API <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/admin/users</code>{" "}
          est utilisable directement.
        </p>
      </div>
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
        Bientôt disponible
      </span>
    </main>
  )
}
