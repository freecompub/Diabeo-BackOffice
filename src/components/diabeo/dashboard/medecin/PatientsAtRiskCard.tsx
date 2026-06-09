/**
 * US-2403 — Patients à suivre (médecin). Top 3 par score on-demand.
 * Polling 5min. DOCTOR-only (jugement clinique).
 */

"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Badge } from "@/components/ui/badge"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { PatientAtRiskItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: PatientAtRiskItem[] }

// Visual variant per risk reason (non-textual — labels are localized via i18n).
// Mirrors `RiskReason` (doctor-dashboard.service.ts) : only the reasons the
// service actually emits. `tirDrop` was dropped server-side (code-review L6),
// so it is intentionally absent here — re-add it alongside the type + i18n keys
// if/when the service reintroduces it.
const REASON_VARIANT: Record<string, "destructive" | "outline" | "secondary"> = {
  recentHypos: "destructive",
  silentMonitoring: "outline",
}

export function PatientsAtRiskCard() {
  const t = useTranslations("dashboard.medecin")
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/patients-at-risk",
    5 * 60_000,
  )
  // code-review H5 — defensive against malformed response.
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null

  return (
    <DiabeoCard role="region" aria-labelledby="card-risk-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-risk-title" className="text-base font-semibold">
          {t("risk.title")}
        </h2>
        <span className="text-xs text-muted-foreground">
          {t("risk.top", { count: items.length || 0 })}
        </span>
      </header>
      {isStale && <StaleBanner message={t("stale")} />}

      <div className="px-4 pb-4">
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">{t("risk.error")}</p>
        )}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState
            variant="noData"
            title={t("risk.emptyTitle")}
            message={t("risk.emptyMessage")}
          />
        )}
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((p) => {
              const variant = REASON_VARIANT[p.reason] ?? "outline"
              const reasonLabel = t.has(`risk.reason.${p.reason}`)
                ? t(`risk.reason.${p.reason}`)
                : p.reason
              const metricLabel = t.has(`risk.metric.${p.reason}`)
                ? t(`risk.metric.${p.reason}`, { count: p.metricValue })
                : p.metricLabel
              return (
                <li
                  key={p.patientId}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                    {(p.patientFirstName || "?").charAt(0).toUpperCase()}
                  </span>
                  <Link
                    href={`/patients/${p.patientId}`}
                    className="flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {p.patientFirstName || t("patientFallback")}
                    {p.pathology ? ` · ${p.pathology}` : ""}
                  </Link>
                  <Badge variant={variant}>{reasonLabel}</Badge>
                  <span className="text-xs text-muted-foreground">{metricLabel}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
