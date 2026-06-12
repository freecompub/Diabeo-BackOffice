/**
 * US-2137 Notification violation CNIL (RGPD Art. 33) — list page.
 *
 * ADMIN-only. Affiche la liste des violations déclarées avec filtres
 * status/severity + bouton "Déclarer une violation" qui ouvre un dialog
 * de création (status=draft initial).
 *
 * Backend : `dataBreachService` (PR #409). Routes : GET/POST
 * `/api/admin/data-breaches`.
 *
 * RGPD Art. 33 : notifier CNIL dans 72h après détection breach high/critical
 * (rgpd.cnil.fr/fr/notifier-une-violation-de-donnees). UI affiche flag
 * `cnilDeadlineHoursRemaining` cap 0 + alerte rouge si exceeded.
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { DataBreachesListClient } from "@/components/diabeo/admin/DataBreachesListClient"

export default async function DataBreachesPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  // UX guard server-side fast bounce ; authorization réelle dans /api/admin/*
  // (auditedRequireRole ADMIN). Cf. /admin/page.tsx pattern.
  if (role !== "ADMIN") redirect("/")
  const t = await getTranslations("admin")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("dataBreaches.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("dataBreaches.subtitle")}
        </p>
      </header>
      <DataBreachesListClient />
    </main>
  )
}
