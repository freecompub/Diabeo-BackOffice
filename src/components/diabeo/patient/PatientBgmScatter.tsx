"use client"

/**
 * US-2638 (slice B) — Nuage de points **glycémie capillaire (BGM)**, modal-day.
 *
 * Remplace la courbe continue CGM dans l'onglet Glycémie pour un patient sans
 * capteur : relevés capillaires épars positionnés par **heure du jour** (t local
 * Europe/Paris), SANS interpolation ni ligne continue (honnête sur la nature
 * discrète des relevés). Bande cible **pathology-aware** (US-2631). Alternative
 * textuelle sr-only synthétique (WCAG 1.1.1) — un point-à-point serait illisible.
 */

import { useTranslations } from "next-intl"
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  ReferenceArea, ResponsiveContainer, Tooltip,
} from "recharts"
import { tokens } from "@/design-system/tokens"

/** Point du nuage capillaire : heure du jour (minutes locales) × glycémie (mg/dL). */
export interface BgmScatterPoint {
  timeMinutes: number
  mgdl: number
}

const fmtHour = (m: number) => `${Math.floor(m / 60)}h`

/**
 * Nuage de points capillaires (modal-day) — remplace la courbe continue CGM en
 * mode BGM. Aucune interpolation (relevés discrets positionnés par heure locale).
 *
 * @param props.points - Relevés `{timeMinutes, mgdl}` sur la période. Vide →
 *   empty-state « aucun relevé ».
 * @param props.targetLowMgdl - Borne basse de la cible (pathology-aware) — bande cible.
 * @param props.targetHighMgdl - Borne haute de la cible (pathology-aware) — bande cible
 *   ET dénominateur du décompte « en cible » du résumé sr-only.
 * @returns Un `role="figure"` (scatter recharts) + un résumé textuel sr-only.
 */
export function PatientBgmScatter({
  points,
  targetLowMgdl,
  targetHighMgdl,
}: {
  points: BgmScatterPoint[]
  targetLowMgdl: number
  targetHighMgdl: number
}) {
  const t = useTranslations("patientDetail")

  if (points.length === 0) {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted-foreground">
        {t("bgmNoReadings")}
      </p>
    )
  }

  const inTarget = points.filter((p) => p.mgdl >= targetLowMgdl && p.mgdl <= targetHighMgdl).length

  return (
    <div role="figure" aria-label={t("bgmScatterAria")}>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.neutral[200]} />
          <XAxis
            type="number" dataKey="timeMinutes" domain={[0, 1440]}
            ticks={[0, 180, 360, 540, 720, 900, 1080, 1260, 1440]} tickFormatter={fmtHour}
            stroke={tokens.neutral[500]} tick={{ fontSize: 11 }}
          />
          <YAxis
            type="number" dataKey="mgdl" domain={[40, 400]} width={38}
            stroke={tokens.neutral[500]} tick={{ fontSize: 11 }} unit=" mg/dL"
          />
          <ZAxis range={[45, 45]} />
          {/* Bande cible pathology-aware. */}
          <ReferenceArea
            y1={targetLowMgdl} y2={targetHighMgdl}
            fill={tokens.glycemia.normal} fillOpacity={0.1} ifOverflow="extendDomain"
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            formatter={(value, name) =>
              name === "mgdl" ? [`${value} mg/dL`, ""] : [fmtHour(value as number), ""]
            }
            contentStyle={{ fontSize: 11 }}
          />
          <Scatter data={points} fill={tokens.brand.primary[600]} fillOpacity={0.75} />
        </ScatterChart>
      </ResponsiveContainer>

      {/* Équivalent textuel synthétique (un point-à-point serait illisible). */}
      <p className="sr-only">{t("bgmScatterSummary", { total: points.length, inTarget })}</p>
    </div>
  )
}
