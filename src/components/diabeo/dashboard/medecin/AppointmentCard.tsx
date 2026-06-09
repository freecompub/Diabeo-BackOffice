/**
 * US-2402 — RDV du jour (médecin). Max 3, tri chronologique. Polling 5min.
 */

"use client"

import { useLocale, useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Badge } from "@/components/ui/badge"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import { bcp47 } from "@/i18n/config"
import type { AppointmentItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: AppointmentItem[] }

// code-review M6 — render time in Europe/Paris cabinet timezone, matching
//   server `todayBounds` semantics. UTC display would shift wall-clock by
//   1-2h on Paris timestamps. The number format follows the active locale.
function formatHour(d: Date | null, locale: string): string {
  if (!d) return "—"
  const date = new Date(d)
  return date.toLocaleTimeString(bcp47(locale), {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  })
}

function minutesUntil(hour: Date | null): number | null {
  if (!hour) return null
  return Math.round((new Date(hour).getTime() - Date.now()) / 60_000)
}

export function AppointmentCard() {
  const t = useTranslations("dashboard.medecin")
  const locale = useLocale()
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/appointments",
    5 * 60_000,
  )
  // code-review H5 — defensive against malformed response.
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null

  return (
    <DiabeoCard role="region" aria-labelledby="card-appointments-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-appointments-title" className="text-base font-semibold">
          {t("appointments.title")}
        </h2>
        <span className="text-xs text-muted-foreground">
          {t("appointments.count", { count: items.length })}
        </span>
      </header>
      {isStale && <StaleBanner message={t("stale")} />}

      <div className="px-4 pb-4">
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">{t("appointments.error")}</p>
        )}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState
            variant="noData"
            title={t("appointments.emptyTitle")}
            message={t("appointments.emptyMessage")}
          />
        )}
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((a) => {
              const mins = minutesUntil(a.hour)
              const imminent = mins !== null && mins <= 30 && mins >= 0
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <Badge
                    variant={imminent ? "default" : "outline"}
                    aria-label={
                      imminent
                        ? t("appointments.imminentAria", { hour: formatHour(a.hour, locale) })
                        : formatHour(a.hour, locale)
                    }
                  >
                    {formatHour(a.hour, locale)}
                    {/* code-review M2 — text fallback for color-only imminent signal. */}
                    {imminent && <span className="ml-1 sr-only">{t("appointments.imminent")}</span>}
                  </Badge>
                  <span className="flex-1 truncate text-sm font-medium">
                    {a.patientFirstName || t("patientFallback")}
                    {a.pathology ? ` · ${a.pathology}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.location === "video"
                      ? t("appointments.video")
                      : a.type ?? t("appointments.inPerson")}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
