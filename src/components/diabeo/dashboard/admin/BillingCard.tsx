/**
 * US-2412 — Facturation à traiter (admin, heuristique fallback).
 *
 * ⚠️ Heuristique : compte les `TeleconsultationActe.invoicedAt IS NULL`
 *  sur Appointment complétés en visio. Table `Invoice` formelle attendue
 *  via US-2107 (V2).
 */

"use client"

import { useTranslations, useLocale } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { BillingMetric } from "@/lib/services/admin-dashboard.service"

type ApiResponse = { item: BillingMetric }

// code-review M4 (re-review) — keep round-euro display for a glance-able
//   KPI ; UI labels the value "arrondi" so an auditor doesn't reconcile
//   the rounded display against the cents in the DB.
// La devise reste EUR (data center OVH Paris, comptabilité française). Seul
// le format (séparateurs, position du symbole) suit la locale utilisateur.
function formatEuros(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(cents / 100)
}

export function BillingCard() {
  const t = useTranslations("adminDashboard")
  const locale = useLocale()
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/admin/billing",
    10 * 60_000,
  )
  const item = data?.item ?? null
  const hasError = error !== null && data === null

  return (
    <DiabeoCard role="region" aria-labelledby="admin-billing-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="admin-billing-title" className="text-base font-semibold">
          {t("billingTitle")}
        </h2>
        <span className="text-xs text-muted-foreground">
          {item ? t("billingPending", { count: item.unbilledCount }) : "—"}
        </span>
      </header>
      {isStale && <StaleBanner message={t("stale")} />}
      <div className="px-4 pb-4">
        {loading && item === null && (
          <p className="text-sm text-muted-foreground">{t("billingLoading")}</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">
            {t("billingLoadError")}
          </p>
        )}
        {item && (
          <dl
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            aria-live="polite"
          >
            <div>
              <dt className="text-xs text-muted-foreground">{t("billingEligible")}</dt>
              <dd className="text-lg font-semibold">{item.totalEligible}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("billingUnbilled")}</dt>
              <dd className="text-lg font-semibold text-glycemia-high">
                {item.unbilledCount}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("billingRecent")}</dt>
              <dd className="text-lg font-semibold text-glycemia-normal">
                {item.recentlyBilled}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("billingAmount")} <span className="opacity-60">{t("billingAmountNote")}</span>
              </dt>
              <dd className="text-lg font-semibold">
                {formatEuros(item.unbilledAmountCents, locale)}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t("billingHeuristic")}
        </p>
      </div>
    </DiabeoCard>
  )
}
