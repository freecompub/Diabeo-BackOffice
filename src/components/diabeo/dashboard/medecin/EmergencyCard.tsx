/**
 * US-2401 — Urgences en cours (médecin).
 *
 * Polling 30s (ADR session Samir 2026-05-13). `role="region"` + live region
 * for screen readers when alerts arrive. Empty state = green "all stable".
 */

"use client"

import { useLocale, useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import { bcp47 } from "@/i18n/config"
import type { UrgencyItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: UrgencyItem[] }

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  info: "secondary",
  warning: "outline",
  critical: "destructive",
}

export function EmergencyCard() {
  const t = useTranslations("dashboard.medecin")
  const locale = useLocale()
  const { data, error, loading, lastUpdatedAt, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/urgencies",
    30_000,
  )

  // code-review H5 — defensive : assume nothing about response shape.
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null

  return (
    <DiabeoCard className="border-s-4 border-s-glycemia-critical" role="region" aria-labelledby="card-urgencies-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-urgencies-title" className="text-base font-semibold text-glycemia-critical">
          {t("urgencies.title")}
        </h2>
        <span className="text-xs text-muted-foreground">
          {/* "Last update" is a CLIENT-relative wall clock (when this browser
              last polled) → formatted in the viewer's own timezone, unlike
              AppointmentCard.formatHour which pins Europe/Paris for the
              cabinet-anchored clinical appointment time. Number format follows
              the active locale. */}
          {lastUpdatedAt
            ? t("lastUpdate", {
                time: new Date(lastUpdatedAt).toLocaleTimeString(bcp47(locale)),
              })
            : "—"}
        </span>
      </header>
      {isStale && <StaleBanner message={t("stale")} />}

      {/* code-review M1 — separate live regions :
            - "polite" announces transitions (loading/empty/error) without
              interrupting reader flow.
            - "assertive" on the count below interrupts for new urgencies. */}
      <div className="px-4 pb-1" role="status" aria-live="polite">
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">{t("urgencies.error")}</p>
        )}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState
            variant="noData"
            title={t("urgencies.emptyTitle")}
            message={t("urgencies.emptyMessage")}
          />
        )}
      </div>
      <div className="px-4 pb-4">
        <p className="sr-only" role="alert" aria-live="assertive">
          {items.length > 0 ? t("urgencies.countAnnounce", { count: items.length }) : ""}
        </p>
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <Badge variant={SEVERITY_VARIANT[u.severity] ?? "default"}>
                  {t.has(`urgencies.alert.${u.alertType}`)
                    ? t(`urgencies.alert.${u.alertType}`)
                    : u.alertType}
                </Badge>
                <span className="flex-1 truncate text-sm font-medium">
                  {u.patientFirstName || t("patientFallback")}
                  {u.pathology ? ` · ${u.pathology}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {u.glucoseValueMgdl !== null
                    ? `${u.glucoseValueMgdl} mg/dL`
                    : u.ketoneValueMmol !== null
                    ? `${u.ketoneValueMmol} mmol/L`
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
