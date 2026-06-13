/**
 * Consultation audit logs (page stub).
 *
 * #11.a session 2026-05-22 — Backend audit log immuable opérationnel
 * (US-2011/2024/2132/2133/2268) avec API `/api/admin/audit-logs`
 * (filtres userId, resource, action, from, to ; ADMIN-only ; GIN partial
 * index `metadata->'patientId'` US-2268 pour forensique CNIL/ANS).
 * UI dédiée non encore livrée. Cette page stub évite le 404 quand un
 * ADMIN clique sur "Audit" dans la sidebar.
 *
 * À remplacer par la vraie UI quand US-2024-UI sera planifiée.
 *
 * Server-side guard : ADMIN-only.
 *
 * TODO V1.5 (LOW-4 HSA round 2 review PR #426) — Quand l'UI réelle
 * arrivera, ajouter `auditService.log({userId, action: "READ",
 * resource: "AUDIT_LOGS_LIST"})` ici (cohérence US-2265). Pas urgent
 * sur le stub puisqu'aucune donnée PHI n'est rendue.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { FileText } from "lucide-react"
import { isKnownRoleString, resolveHomeForRole } from "@/lib/auth/role-home"

export default async function AuditStubPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  // Fail-safe round 2 review (HIGH-1).
  if (!isKnownRoleString(role)) redirect("/login")
  if (role !== "ADMIN") redirect(resolveHomeForRole(role))

  const t = await getTranslations("audit")

  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50">
        <FileText className="h-8 w-8 text-teal-600" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t.rich("description", {
            code: (chunks) => (
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {chunks}
              </code>
            ),
          })}
        </p>
      </div>
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
        {t("comingSoon")}
      </span>
    </main>
  )
}
