/**
 * US-3362 — AGP percentile chart (Ambulatory Glucose Profile).
 *
 * Renders 24h glucose distribution as nested percentile bands:
 *  - outer (10-90%)  pale teal
 *  - inner (25-75%)  mid teal
 *  - median line     dark teal
 *
 * Input: 96 slots @ 15-min intervals (cf. `AgpSlot` in `src/lib/statistics`).
 * Empty state ("Données insuffisantes — porter le capteur ≥ 3 jours")
 * is rendered when fewer than `minSlots` are present.
 *
 * The chart is read-only ; period selection is owned by the parent.
 */

"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { tokens, withAlpha } from "@/design-system/tokens"

/** L1/H7 (re-review) — observe `prefers-reduced-motion` so a mid-session
 *  preference change re-applies to the animation prop. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  })
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [])
  return reduced
}
import {
  ComposedChart,
  Area,
  Line,
  ReferenceArea,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { type AgpSlot } from "@/lib/statistics"
import { GLYCEMIA_THRESHOLDS_MGDL as G } from "@/lib/glycemia-thresholds"

// H4 (re-review) — import the canonical AgpSlot type from statistics.ts to
// avoid shape-drift. Re-exported here as `AgpSlotPoint` for backward-compat
// with existing callers.
export type AgpSlotPoint = AgpSlot

export interface AgpPercentileChartProps {
  slots: AgpSlotPoint[]
  /** Glycemia target range in mg/dL (default ADA: 70–180). */
  targetLowMgdl?: number
  targetHighMgdl?: number
  /** Minimum slot count to render the chart (rest → empty state). */
  minSlots?: number
  height?: number
}

/** Convert g/L → mg/dL (input stored in g/L per repo convention). */
function glToMgdl(gl: number): number {
  return gl * 100
}

function formatHour(minutes: number): string {
  const h = Math.floor(minutes / 60)
  return h.toString().padStart(2, "0") + ":00"
}

/** M7/L3 — narrow keys + module-scope (allocated once, not per render). */
const USER_VISIBLE_KEYS = new Set(["p10", "p25", "p50", "p75", "p90"])

/**
 * Valeur d'infobulle AGP. Sécurité clinique (US-2635) : un créneau sans relevé
 * porte `null` → « — », jamais « 0 mg/dL » (`Number(null) === 0` serait fini).
 * Défense en profondeur indépendante du `filterNull` par défaut de Recharts.
 */
export function agpTooltipValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} mg/dL` : "—"
}

export function AgpPercentileChart({
  slots,
  targetLowMgdl = G.TARGET_LOW,
  targetHighMgdl = G.TARGET_HIGH,
  minSlots = 12, // ≈ 3h of capture across the day
  height = 280,
}: AgpPercentileChartProps) {
  // All hooks must be called BEFORE any conditional return (Rules of Hooks).
  // H7 / L1 (re-review) — listener-based hook reacts to runtime preference change.
  const prefersReducedMotion = useReducedMotion()
  const t = useTranslations("agpPercentileChart")

  /** Built inside component so translations are reactive to locale changes. */
  const percentileLabels: Record<"p10" | "p25" | "p50" | "p75" | "p90", string> = {
    p10: t("p10"),
    p25: t("p25"),
    p50: t("median"),
    p75: t("p75"),
    p90: t("p90"),
  }

  // Build chart data: stacked Areas need cumulative deltas, but Recharts
  // supports value pairs via Area with `stackId`. We derive bands as raw
  // mg/dL pairs and rely on layered Areas for the visual bands.
  // M4 (re-review) — Math.max(0, …) clamp guards against inverted percentiles
  // from upstream stats bugs ; a negative slice would visually "eat" the floor.
  // Sécurité clinique (US-2635) : un créneau SANS relevé (`count === 0`) ne doit
  // PAS contribuer un point à 0 mg/dL (`percentile([]) → 0`) — sinon la médiane
  // plonge à 0 (fausse hypoglycémie visuelle). On le rend `null` → Recharts
  // rompt la ligne/bande (gap) au lieu de la tirer à zéro.
  const data = useMemo(() => slots.map((s) => {
    const empty = s.count === 0
    return {
      minute: s.timeMinutes,
      hour: formatHour(s.timeMinutes),
      p10: empty ? null : glToMgdl(s.p10),
      p25: empty ? null : glToMgdl(s.p25),
      p50: empty ? null : glToMgdl(s.p50),
      p75: empty ? null : glToMgdl(s.p75),
      p90: empty ? null : glToMgdl(s.p90),
      bandLow: empty ? null : Math.max(0, glToMgdl(s.p25 - s.p10)),
      bandMid: empty ? null : Math.max(0, glToMgdl(s.p75 - s.p25)),
      bandHigh: empty ? null : Math.max(0, glToMgdl(s.p90 - s.p75)),
      floor: empty ? null : glToMgdl(s.p10),
    }
  }), [slots])

  /** Recharts uses internal dataKeys (`bandLow/bandMid/bandHigh/floor`) for
   *  the stacked-area trick. Filter them out of the tooltip + show only the
   *  user-meaningful percentiles. (M5 re-review.) */

  // Empty-state check runs AFTER hooks (Rules of Hooks compliance).
  // US-2635 : basé sur les slots RÉELLEMENT renseignés (`count > 0`), pas sur
  // `slots.length` (toujours 96) — sinon un patient sans CGM verrait un graphe
  // plat à 0 au lieu de l'état vide.
  const populatedCount = slots.reduce((n, s) => (s.count > 0 ? n + 1 : n), 0)
  if (populatedCount < minSlots) {
    return (
      <div
        role="status"
        className="flex flex-col items-center justify-center rounded-lg border
                   border-dashed border-border p-6 text-center text-sm text-muted-foreground"
        style={{ height }}
      >
        <p className="mb-1 font-medium text-foreground">
          {t("emptyTitle")}
        </p>
        <p>{t("emptyDescription")}</p>
      </div>
    )
  }

  return (
    <div className="w-full" role="figure" aria-label={t("figureAriaLabel")}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 24, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.neutral[200]} />
          <XAxis
            dataKey="minute"
            type="number"
            domain={[0, 1440]}
            ticks={[0, 240, 480, 720, 960, 1200, 1440]}
            tickFormatter={(m) => formatHour(m)}
            stroke={tokens.neutral[500]}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            // Graduations **pathology-aware** (US-2635) : les bornes cibles
            // patient (GD 63–140 vs 70–180) marquent l'axe, pas des constantes
            // ADA. 300 (headroom) reste purement graphique.
            domain={[G.CRITICAL_LOW, 300]}
            ticks={Array.from(
              new Set([G.CRITICAL_LOW, targetLowMgdl, targetHighMgdl, G.SEVERE_HYPER]),
            ).sort((a, b) => a - b)}
            stroke={tokens.neutral[500]}
            tick={{ fontSize: 11 }}
            label={{
              value: "mg/dL", angle: -90,
              position: "insideLeft", offset: 0,
              style: { textAnchor: "middle", fontSize: 11, fill: tokens.neutral[500] },
            }}
          />
          {/* Target range band — green tint */}
          <ReferenceArea
            y1={targetLowMgdl} y2={targetHighMgdl}
            fill={tokens.glycemia.normal} fillOpacity={0.08}
            ifOverflow="extendDomain"
          />
          {/* Stacked percentile bands. Floor (transparent) lifts the visible
              bands to start at p10. Each subsequent Area stacks delta height. */}
          <Area type="monotone" dataKey="floor" stackId="agp"
                stroke="none" fill="transparent"
                isAnimationActive={!prefersReducedMotion} />
          <Area type="monotone" dataKey="bandLow" stackId="agp"
                stroke="none" fill={tokens.brand.primary[600]} fillOpacity={0.12}
                isAnimationActive={!prefersReducedMotion} />
          <Area type="monotone" dataKey="bandMid" stackId="agp"
                stroke="none" fill={tokens.brand.primary[600]} fillOpacity={0.28}
                isAnimationActive={!prefersReducedMotion} />
          <Area type="monotone" dataKey="bandHigh" stackId="agp"
                stroke="none" fill={tokens.brand.primary[600]} fillOpacity={0.12}
                isAnimationActive={!prefersReducedMotion} />
          {/* Median line */}
          <Line type="monotone" dataKey="p50"
                stroke={tokens.brand.primary[700]} strokeWidth={2} dot={false}
                isAnimationActive={!prefersReducedMotion} />
          <Tooltip
            formatter={(value, name) => {
              const key = String(name)
              if (!USER_VISIBLE_KEYS.has(key)) return null as never
              const label = percentileLabels[key as keyof typeof percentileLabels] ?? key
              return [agpTooltipValue(value), label]
            }}
            labelFormatter={(m) => formatHour(m as number)}
            contentStyle={{ fontSize: 12 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span
            className="w-3 h-1 inline-block"
            style={{ backgroundColor: tokens.brand.primary[700] }}
            aria-label={t("legendMedianAriaLabel")}
            role="img"
          />
          {t("legendMedian")}
        </span>
        <span className="flex items-center gap-1">
          <span
            className="w-3 h-3 inline-block"
            style={{ backgroundColor: withAlpha(tokens.brand.primary[600], 0.28) }}
            aria-label={t("legendBand2575AriaLabel")}
            role="img"
          />
          {t("legendBand2575")}
        </span>
        <span className="flex items-center gap-1">
          <span
            className="w-3 h-3 inline-block"
            style={{ backgroundColor: withAlpha(tokens.brand.primary[600], 0.12) }}
            aria-label={t("legendBand1090AriaLabel")}
            role="img"
          />
          {t("legendBand1090")}
        </span>
        <span className="flex items-center gap-1">
          <span
            className="w-3 h-3 inline-block"
            style={{ backgroundColor: withAlpha(tokens.glycemia.normal, 0.08) }}
            aria-label={t("legendTargetAriaLabel")}
            role="img"
          />
          {t("legendTarget", { low: targetLowMgdl, high: targetHighMgdl })}
        </span>
      </div>

      {/* C1 (re-review) — sr-only table for screen readers (WCAG 1.1.1 / 1.3.1).
          Pattern aligned with CgmChart.tsx — required in a medical app. */}
      <table className="sr-only">
        <caption>
          {t("tableCaption", { low: targetLowMgdl, high: targetHighMgdl })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("colHour")}</th>
            <th scope="col">{t("p10")}</th>
            <th scope="col">{t("p25")}</th>
            <th scope="col">{t("median")}</th>
            <th scope="col">{t("p75")}</th>
            <th scope="col">{t("p90")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            // Créneau sans relevé (percentiles null) → « — » (pas de 0 trompeur).
            const cell = (v: number | null) =>
              v === null ? "—" : t("valueMgdl", { value: Math.round(v) })
            return (
              <tr key={row.minute}>
                <th scope="row">{row.hour}</th>
                <td>{cell(row.p10)}</td>
                <td>{cell(row.p25)}</td>
                <td>{cell(row.p50)}</td>
                <td>{cell(row.p75)}</td>
                <td>{cell(row.p90)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
