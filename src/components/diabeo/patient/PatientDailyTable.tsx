"use client"

/**
 * US-2636 — Vue « Tableau journalier » : 1 ligne par jour calendaire
 * (Europe/Paris) pour la période sélectionnée. Données **projetées serveur**
 * (`/api/analytics/daily-stats`, ≤ 90 lignes triées desc) — aucun calcul
 * clinique ici. Piloté par la période du contexte (`usePeriodResource`, lazy).
 *
 * Le % en cible est **pathology-aware** (calculé serveur avec les bornes du
 * patient). L'onglet parent porte le sélecteur de période/vue et la bande cible.
 */

import { useLocale, useTranslations } from "next-intl"
import { bcp47 } from "@/i18n/config"
import { usePeriodResource } from "./PatientRecordContext"

/** Miroir de `DailyStat` (analytics.service) — projeté serveur, mg/dL. */
interface DailyStat {
  day: string
  avgMgdl: number
  minMgdl: number
  maxMgdl: number
  count: number
  inTargetPct: number
}

/**
 * Vue « Tableau journalier » (1 ligne/jour) de l'onglet Profil glycémique.
 *
 * Sans props : lazy, pilotée par la période via `usePeriodResource` sur
 * `/api/analytics/daily-stats`. Rend une table accessible (min/moy/max, TIR,
 * relevés par jour), états loading/error/empty inclus.
 *
 * @returns Le tableau journalier.
 */
export function PatientDailyTable() {
  const t = useTranslations("patientDetail")
  const locale = useLocale()
  const { data, loading, error } = usePeriodResource<DailyStat[]>({
    endpoint: "/api/analytics/daily-stats",
    map: (raw) => raw as DailyStat[],
  })

  if (loading && !data) {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted-foreground">
        {t("dailyLoading")}
      </p>
    )
  }
  if (error || !data) {
    return (
      <p role="alert" className="rounded-md border border-feedback-error bg-error-bg px-4 py-3 text-sm text-error-fg">
        {t("dailyError")}
      </p>
    )
  }
  if (data.length === 0) {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted-foreground">
        {t("dailyEmpty")}
      </p>
    )
  }

  const fmtDay = (day: string) =>
    // Midi local pour éviter tout décalage de jour à la conversion.
    new Date(`${day}T12:00:00`).toLocaleDateString(bcp47(locale), {
      weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris",
    })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("dailyTableCaption")}</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pe-3 font-medium">{t("dailyColDay")}</th>
            <th scope="col" className="py-2 pe-3 text-right font-medium">{t("dailyColAvg")}</th>
            <th scope="col" className="py-2 pe-3 text-right font-medium">{t("dailyColInTarget")}</th>
            <th scope="col" className="py-2 pe-3 text-right font-medium">{t("dailyColMin")}</th>
            <th scope="col" className="py-2 pe-3 text-right font-medium">{t("dailyColMax")}</th>
            <th scope="col" className="py-2 text-right font-medium">{t("dailyColCount")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day} className="border-b border-border/60 tabular-nums">
              <th scope="row" className="py-2 pe-3 text-left font-normal text-foreground">{fmtDay(d.day)}</th>
              <td className="py-2 pe-3 text-right font-medium">{d.avgMgdl} mg/dL</td>
              <td className="py-2 pe-3 text-right">{d.inTargetPct}%</td>
              <td className="py-2 pe-3 text-right text-muted-foreground">{d.minMgdl}</td>
              <td className="py-2 pe-3 text-right text-muted-foreground">{d.maxMgdl}</td>
              <td className="py-2 text-right text-muted-foreground">{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
