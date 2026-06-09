"use client"

/**
 * US-2018b — Onglet « Profil glycémique » : synthèse (moyenne, GMI, CV),
 * Time-in-Range et hypoglycémies, câblés sur le patient de la consultation via
 * le jeton éphémère. Les formes correspondent AUX VRAIS retours des services
 * analytics (review #523) : `glycemic-profile` → `{ captureRate, metrics, tir }`,
 * `time-in-range` → `{ tir }`, `hypoglycemia` → `{ episodeCount, episodes }`.
 * Le TIR serveur est `{severeHypo,hypo,inRange,elevated,hyper}` → mappé sur le
 * contrat 5 zones `{veryLow,low,inRange,high,veryHigh}` des composants charts.
 */

import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DataSummaryGrid } from "@/components/diabeo/widgets/DataSummaryGrid"
import { TimeInRangeChart } from "@/components/diabeo/charts/TimeInRangeChart"
import { HypoglycemiaCounter } from "@/components/diabeo/charts/HypoglycemiaCounter"
import type { WidgetData } from "@/components/diabeo/widgets/types"
import type { TimeInRangeData, HypoglycemiaData } from "@/components/diabeo/charts/types"
import { useConsultationData } from "../useConsultationData"
import { TabError, TabLoading } from "./TabState"

/** TIR serveur (statistics.ts `TirResult`). Pourcentages. */
interface TirResult {
  severeHypo: number
  hypo: number
  inRange: number
  elevated: number
  hyper: number
}
interface ProfileResponse {
  captureRate: number
  metrics: { averageGlucoseMgdl: number; gmi: number; coefficientOfVariation: number }
  tir: TirResult
}
interface TimeInRangeResponse {
  tir: TirResult
}
interface HypoResponse {
  episodeCount: number
}

/** Mappe le TIR serveur (5 zones métier) sur le contrat des composants charts. */
function toFiveZones(t: TirResult): TimeInRangeData {
  return { veryLow: t.severeHypo, low: t.hypo, inRange: t.inRange, high: t.elevated, veryHigh: t.hyper }
}

export function GlycemicProfileTab({ cTok }: { cTok: string }) {
  const profile = useConsultationData<ProfileResponse>(
    "/api/analytics/glycemic-profile?period=14d",
    cTok,
  )
  const tir = useConsultationData<TimeInRangeResponse>("/api/analytics/time-in-range?period=7d", cTok)
  const hypo = useConsultationData<HypoResponse>("/api/analytics/hypoglycemia?period=30d", cTok)

  if (profile.loading) return <TabLoading />
  if (profile.error || !profile.data) return <TabError />

  const p = profile.data
  const tirZones = toFiveZones(tir.data?.tir ?? p.tir)

  const widgetData: WidgetData = {
    averageGlucose: { value: Math.round(p.metrics.averageGlucoseMgdl), unit: "mg/dL" },
    // GMI (Glucose Management Indicator) = équivalent moderne de l'HbA1c estimée.
    hba1c: { value: Number(p.metrics.gmi.toFixed(1)) },
    hypoglycemia: { count: hypo.data?.episodeCount ?? 0 },
    timeInRange: tirZones,
    cv: { value: Number(p.metrics.coefficientOfVariation.toFixed(1)) },
  }

  const hypoChartData: HypoglycemiaData = {
    totalCount: hypo.data?.episodeCount ?? 0,
    lastEventTime: undefined,
    dailyCounts: [],
  }

  return (
    <div className="space-y-4">
      <DiabeoCard variant="outlined" padding="md">
        <DataSummaryGrid data={widgetData} loading={tir.loading || hypo.loading} />
      </DiabeoCard>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DiabeoCard variant="elevated" padding="md">
          <TimeInRangeChart data={tirZones} />
        </DiabeoCard>
        <DiabeoCard variant="elevated" padding="md">
          <HypoglycemiaCounter data={hypoChartData} />
        </DiabeoCard>
      </div>
    </div>
  )
}
