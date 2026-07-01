"use client"

/**
 * US-2639 — **Carnet glycémique capillaire** par moment de la journée.
 *
 * Remplace l'onglet AGP pour un patient sans capteur (l'AGP — percentiles CGM —
 * n'est pas calculable). Terminologie « carnet », jamais « AGP » ni « temps dans
 * la cible » (AC-1). Moyenne par moment (Nuit / Matin / Midi / Soir), colorée
 * pathology-aware (bornes `targetRangeMgdl`) ; « données insuffisantes » sous le
 * plancher de relevés (AC-3). Données projetées serveur, pilotées par la période
 * (lazy — l'onglet est démonté quand inactif).
 */

import { useTranslations } from "next-intl"
import { usePeriodResource } from "./PatientRecordContext"
import { PeriodSelector } from "./PeriodSelector"
import { GlycemiaValue } from "@/components/diabeo"
import { DAY_MOMENTS, type DayMoment } from "@/lib/day-moments"

interface CarnetData {
  period: { days: number }
  targetRangeMgdl: { low: number; high: number }
  moments: { moment: DayMoment; count: number; insufficient: boolean; avgMgdl: number | null }[]
}

export function PatientBgmCarnet() {
  const t = useTranslations("patientDetail")
  const { data, loading, error } = usePeriodResource<CarnetData>({
    endpoint: "/api/analytics/bgm-daily-pattern",
    map: (raw) => raw as CarnetData,
  })

  const selector = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span id="carnet-period-label" className="text-sm font-medium text-muted-foreground">
        {t("periodSelectorLabel")}
      </span>
      <PeriodSelector labelledBy="carnet-period-label" />
    </div>
  )

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {selector}
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">{t("carnetLoading")}</p>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="space-y-4">
        {selector}
        <p role="alert" className="rounded-md border border-feedback-error bg-error-bg px-4 py-3 text-sm text-error-fg">
          {t("carnetError")}
        </p>
      </div>
    )
  }

  const byMoment = new Map(data.moments.map((m) => [m.moment, m]))
  const thresholds = { low: data.targetRangeMgdl.low, high: data.targetRangeMgdl.high }

  return (
    <div className="space-y-4">
      {selector}
      {/* Titre de section (hiérarchie : ancre les h4 des moments — WCAG 1.3.1). */}
      <h3 className="text-base font-semibold text-foreground">{t("carnetTitle")}</h3>
      <p role="status" className="rounded-md border border-feedback-info/25 bg-feedback-info-bg px-4 py-2 text-sm text-feedback-info-fg">
        {t("carnetBanner")}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DAY_MOMENTS.map((m) => {
          const cell = byMoment.get(m)
          return (
            <div key={m} className="rounded-lg border border-border bg-card p-4">
              <h4 className="text-sm font-semibold text-foreground">{t(`meal_${m}`)}</h4>
              <div className="mt-2">
                {cell && !cell.insufficient && cell.avgMgdl !== null ? (
                  <>
                    <GlycemiaValue value={cell.avgMgdl} unit="mg/dL" thresholds={thresholds} size="sm" showZoneLabel />
                    <p className="mt-1 text-xs text-muted-foreground">{t("carnetReadings", { count: cell.count })}</p>
                  </>
                ) : (
                  <p role="status" className="text-xs text-muted-foreground">{t("carnetInsufficient")}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t("carnetCaveat")}</p>
    </div>
  )
}
