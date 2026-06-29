/**
 * US-2403 — Patients à suivre (médecin). Top 3 par score on-demand.
 * Polling 5min. DOCTOR-only (jugement clinique). Lignes « Home v3 » : avatar
 * teinté par motif, pathologie, métrique, pill motif + action « Ouvrir ».
 */

"use client"

import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { DashboardCardHeader } from "@/components/diabeo/dashboard/DashboardCardHeader"
import {
  DashboardRow,
  DashboardAvatar,
  DashboardRowAction,
  type DashboardAvatarTint,
} from "@/components/diabeo/dashboard/DashboardRow"
import {
  DashboardPill,
  PathologyPill,
  type DashboardPillVariant,
} from "@/components/diabeo/dashboard/DashboardPill"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { PatientAtRiskItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: PatientAtRiskItem[] }

// Motif de suivi → teinte avatar + variante pill (libellés localisés via i18n,
// jamais portés par la seule couleur). `tirDrop` resté absent côté service
// (code-review L6) — réintroduire ici si la query le réémet un jour.
const REASON_TINT: Record<string, DashboardAvatarTint> = {
  recentHypos: "error",
  silentMonitoring: "warning",
}
const REASON_PILL: Record<string, DashboardPillVariant> = {
  recentHypos: "error",
  silentMonitoring: "warning",
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
      <DashboardCardHeader
        titleId="card-risk-title"
        title={t("risk.title")}
        dot="warning"
        count={items.length}
        more={{ href: "/patients", label: t("urgencies.seeAll") }}
      />
      {isStale && <StaleBanner message={t("stale")} />}

      <div className="px-4 pb-4 pt-2">
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
              const name = p.patientFirstName || t("patientFallback")
              const reasonLabel = t.has(`risk.reason.${p.reason}`)
                ? t(`risk.reason.${p.reason}`)
                : p.reason
              const metricLabel = t.has(`risk.metric.${p.reason}`)
                ? t(`risk.metric.${p.reason}`, { count: p.metricValue })
                : p.metricLabel
              return (
                <DashboardRow
                  key={p.patientId}
                  leading={
                    <DashboardAvatar
                      initials={name.charAt(0).toUpperCase()}
                      tint={REASON_TINT[p.reason] ?? "neutral"}
                    />
                  }
                  title={
                    <span className="flex items-center gap-2">
                      {name}
                      <PathologyPill pathology={p.pathology} />
                    </span>
                  }
                  sub={metricLabel}
                  trailing={
                    <>
                      <DashboardPill variant={REASON_PILL[p.reason] ?? "info"}>
                        {reasonLabel}
                      </DashboardPill>
                      <DashboardRowAction
                        href={`/patients/${p.patientId}`}
                        aria-label={t("urgencies.openAria", { name })}
                      >
                        {t("urgencies.open")}
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
