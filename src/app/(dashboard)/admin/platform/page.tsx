/**
 * US-2613 (PR6b-1) — Hub « Administration plateforme » (SYSTEM_ADMIN, ADMIN V1).
 *
 * Point d'entrée des écrans plateforme (structure : tenants, établissements,
 * bootstrap). La gouvernance (politique de vérification, validation PS, personnel)
 * arrive en PR6b-2. ADMIN-only (filtrage serveur ; enforcement réel côté API).
 *
 * ⚠️ V1 : la garantie « SYSTEM_ADMIN sans accès aux données de santé » n'est
 * effective qu'en V4 (dépend de F1) — risque accepté documenté (DPIA).
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import Link from "next/link"
import { Building, Building2, UserPlus, ChevronRight } from "lucide-react"

export default async function PlatformAdminHubPage() {
  const role = (await headers()).get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  const t = await getTranslations("platformAdmin")

  const cards = [
    { href: "/admin/tenants", labelKey: "hubTenants", descKey: "hubTenantsDesc", Icon: Building },
    { href: "/admin/cabinets", labelKey: "hubEstablishments", descKey: "hubEstablishmentsDesc", Icon: Building2 },
    { href: "/admin/platform/bootstrap", labelKey: "hubBootstrap", descKey: "hubBootstrapDesc", Icon: UserPlus },
  ] as const

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("hubTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("hubSubtitle")}</p>
      </header>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("hubTitle")}>
        {cards.map(({ href, labelKey, descKey, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex h-full min-h-11 items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Icon className="size-6 shrink-0 text-primary" aria-hidden="true" />
              <div className="flex-1">
                <span className="font-medium">{t(labelKey)}</span>
                <p className="mt-1 text-sm text-muted-foreground">{t(descKey)}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
