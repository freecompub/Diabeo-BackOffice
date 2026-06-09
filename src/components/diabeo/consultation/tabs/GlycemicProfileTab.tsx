"use client"

/**
 * US-2018b — Onglet « Profil glycémique » : reprend les vues analytics (synthèse
 * 6 métriques, Time-in-Range, hypoglycémies) câblées sur le patient de la
 * consultation via le jeton éphémère.
 */

import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DataSummaryGrid } from "@/components/diabeo/widgets/DataSummaryGrid"
import { TimeInRangeChart } from "@/components/diabeo/charts/TimeInRangeChart"
import { HypoglycemiaCounter } from "@/components/diabeo/charts/HypoglycemiaCounter"
import type { WidgetData } from "@/components/diabeo/widgets/types"
import type { TimeInRangeData, HypoglycemiaData } from "@/components/diabeo/charts/types"
import { useConsultationData } from "../useConsultationData"
import { TabError, TabLoading } from "./TabState"

interface GlycemicProfileResponse {
  avg: number
  hba1c: number
  cv: number
  sd: number
  tir: { veryLow: number; low: number; inRange: number; high: number; veryHigh: number }
  captureRate: number
}
interface HypoResponse {
  totalCount: number
  lastEventTime?: string
  dailyCounts: { date: string; count: number }[]
}

export function GlycemicProfileTab({ cTok }: { cTok: string }) {
  const profile = useConsultationData<GlycemicProfileResponse>(
    "/api/analytics/glycemic-profile?period=14d",
    cTok,
  )
  const tir = useConsultationData<TimeInRangeData>("/api/analytics/time-in-range?period=7d", cTok)
  const hypo = useConsultationData<HypoResponse>("/api/analytics/hypoglycemia?period=30d", cTok)

  if (profile.loading) return <TabLoading />
  if (profile.error || !profile.data) return <TabError />

  const p = profile.data
  const widgetData: WidgetData = {
    averageGlucose: { value: Math.round(p.avg), unit: "mg/dL" },
    hba1c: { value: Number(p.hba1c.toFixed(1)) },
    hypoglycemia: {
      count: hypo.data?.totalCount ?? 0,
      lastEvent: hypo.data?.lastEventTime ? new Date(hypo.data.lastEventTime) : undefined,
    },
    timeInRange: {
      inRange: tir.data?.inRange ?? p.tir.inRange,
      low: tir.data?.low ?? p.tir.low,
      veryLow: tir.data?.veryLow ?? p.tir.veryLow,
      high: tir.data?.high ?? p.tir.high,
      veryHigh: tir.data?.veryHigh ?? p.tir.veryHigh,
    },
    cv: { value: Number(p.cv.toFixed(1)) },
    standardDeviation: { value: Math.round(p.sd), unit: "mg/dL" },
  }

  const tirChartData: TimeInRangeData = tir.data ?? {
    veryLow: 0,
    low: 0,
    inRange: 0,
    high: 0,
    veryHigh: 0,
  }
  const hypoChartData: HypoglycemiaData = {
    totalCount: hypo.data?.totalCount ?? 0,
    lastEventTime: hypo.data?.lastEventTime ? new Date(hypo.data.lastEventTime) : undefined,
    dailyCounts: hypo.data?.dailyCounts ?? [],
  }

  return (
    <div className="space-y-4">
      <DiabeoCard variant="outlined" padding="md">
        <DataSummaryGrid data={widgetData} loading={tir.loading || hypo.loading} />
      </DiabeoCard>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DiabeoCard variant="elevated" padding="md">
          <TimeInRangeChart data={tirChartData} />
        </DiabeoCard>
        <DiabeoCard variant="elevated" padding="md">
          <HypoglycemiaCounter data={hypoChartData} />
        </DiabeoCard>
      </div>
    </div>
  )
}
