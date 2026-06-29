/**
 * US-2402 — RDV du jour (médecin). Max 3, tri chronologique. Polling 5min.
 * Lignes « Home v3 » : heure en tête, nom + pathologie, type/lieu, action
 * « Préparer » (ouvre le dossier patient).
 */

"use client"

import { useLocale, useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { DashboardCardHeader } from "@/components/diabeo/dashboard/DashboardCardHeader"
import {
  DashboardRow,
  DashboardRowAction,
} from "@/components/diabeo/dashboard/DashboardRow"
import { DashboardPill, PathologyPill } from "@/components/diabeo/dashboard/DashboardPill"
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
      <DashboardCardHeader
        titleId="card-appointments-title"
        title={t("appointments.title")}
        dot="info"
        count={items.length}
        more={{ href: "/appointments", label: t("appointments.agenda") }}
      />
      {isStale && <StaleBanner message={t("stale")} />}

      <div className="px-4 pb-4 pt-2">
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
            {items.map((a, index) => {
              const mins = minutesUntil(a.hour)
              const imminent = mins !== null && mins <= 30 && mins >= 0
              const name = a.patientFirstName || t("patientFallback")
              const typeLabel =
                a.location === "video"
                  ? t("appointments.video")
                  : a.type ?? t("appointments.inPerson")
              return (
                <DashboardRow
                  key={a.id}
                  leading={
                    <span
                      className="w-12 shrink-0 font-mono text-xs font-semibold tabular-nums text-muted-foreground"
                      aria-label={
                        imminent
                          ? t("appointments.imminentAria", { hour: formatHour(a.hour, locale) })
                          : formatHour(a.hour, locale)
                      }
                    >
                      {formatHour(a.hour, locale)}
                    </span>
                  }
                  title={
                    <span className="flex items-center gap-2">
                      {name}
                      <PathologyPill pathology={a.pathology} />
                    </span>
                  }
                  sub={typeLabel}
                  trailing={
                    <>
                      {imminent && (
                        <DashboardPill variant="info">
                          {t("appointments.imminent")}
                        </DashboardPill>
                      )}
                      <DashboardRowAction
                        href={`/patients/${a.patientId}`}
                        variant={index === 0 ? "primary" : "default"}
                        aria-label={t("appointments.prepareAria", { name })}
                      >
                        {t("appointments.prepare")}
                      </DashboardRowAction>
                    </>
                  }
                />
              )
            })}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
