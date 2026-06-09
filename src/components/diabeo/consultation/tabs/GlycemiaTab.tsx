"use client"

/** US-2018b — Onglet « Glycémie » : courbe CGM (24 h) du patient consulté. */

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { CgmChart } from "@/components/diabeo/CgmChart"
import { useConsultationData } from "../useConsultationData"
import { TabError, TabLoading } from "./TabState"

// `valueGl` est un Decimal Prisma → sérialisé en string par NextResponse.json.
type CgmEntry = { valueGl: number | string; timestamp: string }

// Fenêtre 24h. Calculée une seule fois au montage du module pour ne pas changer
// l'URL (donc la clé de fetch) à chaque rendu.
const NOW = Date.now()
const FROM = new Date(NOW - 24 * 3600_000).toISOString()
const TO = new Date(NOW).toISOString()
const CGM_PATH = `/api/cgm?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`

export function GlycemiaTab({ cTok }: { cTok: string }) {
  const t = useTranslations("consultation")
  const { data, loading, error } = useConsultationData<CgmEntry[]>(CGM_PATH, cTok)

  const points = useMemo(
    () =>
      (data ?? []).map((e) => ({
        time: new Date(e.timestamp).toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        glucose: Math.round(Number(e.valueGl) * 18),
      })),
    [data],
  )

  if (loading) return <TabLoading />
  if (error) return <TabError />
  if (points.length === 0) return <DiabeoEmptyState variant="noData" />

  return (
    <DiabeoCard variant="elevated" padding="md">
      <h3 className="mb-2 text-sm font-semibold">{t("glycemia.title")}</h3>
      <CgmChart data={points} />
    </DiabeoCard>
  )
}
