/**
 * US-2606 — Atterrissage **cabinet-agnostique** des routes du bloc « Gestion »
 * (`/cabinet/{team,billing,payments,settings}`) — Server Component.
 *
 * Résout le périmètre de gestion (Q2) du caller serveur, puis :
 *  - `ADMIN` → redirigé vers l'espace plateforme `/admin/cabinets` (il gère tous
 *    les cabinets ; le bloc gestion est réservé aux Q2 membership-driven) ;
 *  - **0** cabinet managé → `notFound()` (le bloc n'aurait pas dû être visible) ;
 *  - **1** cabinet → redirection directe vers la section de CE cabinet ;
 *  - **N** cabinets → sélecteur (le caller choisit le cabinet).
 *
 * Aucune donnée de santé : gestion = PII admin uniquement (axe Q2 orthogonal).
 */

import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { ChevronRight, ShieldCheck } from "lucide-react"
import type { Role } from "@prisma/client"
import { getManagementScopes } from "@/lib/capabilities"
import { Badge } from "@/components/ui/badge"

/** Sections du bloc gestion → segment de route per-id + clé de libellé nav. */
export type ManagementSection = "team" | "billing" | "payments" | "settings"

const SECTION_SEGMENT: Record<ManagementSection, string> = {
  team: "members",
  billing: "billing",
  payments: "payments",
  settings: "settings",
}

const SECTION_LABEL_KEY: Record<ManagementSection, string> = {
  team: "gestionTeam",
  billing: "gestionBilling",
  payments: "gestionPayments",
  settings: "gestionSettings",
}

export async function CabinetManagementLanding({
  section,
}: {
  section: ManagementSection
}) {
  const h = await headers()
  const userId = Number(h.get("x-user-id"))
  const role = h.get("x-user-role") as Role | null
  if (!userId || !Number.isInteger(userId) || !role) redirect("/login")

  // L'ADMIN plateforme gère via l'espace dédié, pas via le bloc gestion cabinet.
  if (role === "ADMIN") redirect("/admin/cabinets")

  const scopes = await getManagementScopes(userId)
  const segment = SECTION_SEGMENT[section]

  // 0 cabinet managé : le bloc gestion n'aurait pas dû être rendu → 404 uniforme.
  if (scopes.length === 0) notFound()
  // 1 seul cabinet : pas de choix à faire, on entre directement dans la section.
  if (scopes.length === 1) redirect(`/cabinet/${scopes[0].serviceId}/${segment}`)

  // N cabinets : sélecteur.
  const t = await getTranslations("cabinetMgmt")
  const tNav = await getTranslations("nav")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("pickerTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pickerSubtitle", { section: tNav(SECTION_LABEL_KEY[section]) })}
        </p>
      </header>

      <ul className="flex flex-col gap-2" aria-label={t("pickerTitle")}>
        {scopes.map((scope) => (
          <li key={scope.serviceId}>
            <Link
              href={`/cabinet/${scope.serviceId}/${segment}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              <span className="flex items-center gap-2">
                <span>{scope.serviceName}</span>
                {scope.isPrincipalAdmin && (
                  // `variant="secondary"` (et non `bg-primary/10 text-primary`) :
                  // contraste AA conforme + cohérent avec MembersManagementClient.
                  <Badge variant="secondary" className="gap-1">
                    <ShieldCheck className="size-3" aria-hidden="true" />
                    {t("principalBadge")}
                  </Badge>
                )}
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
