"use client"

/**
 * US-2637 — Mini-courbe glycémique moyenne d'un moment (repas aligné à t=0).
 *
 * Read-only, projetée serveur (buckets déjà moyennés, ≥ 3 relevés/bucket). Bande
 * cible **pathology-aware** (0 → `targetHighMgdl`), ligne verticale au repas
 * (t=0). Empty-state « données insuffisantes » sous 3 repas appariés (pas de
 * courbe fabriquée). Aucun calcul clinique ici.
 */

import { useTranslations } from "next-intl"
import {
  ComposedChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis,
  CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts"
import { tokens } from "@/design-system/tokens"

export interface MomentCurveView {
  moment: "morning" | "noon" | "evening" | "night"
  pairedMeals: number
  insufficient: boolean
  buckets: { offsetMin: number; avgMgdl: number }[]
  avgPreMgdl: number | null
  avgPostMgdl: number | null
  avgPeakMgdl: number | null
  targetHighMgdl: number
  highExcursion: boolean
}

export function MealMomentCurve({ curve }: { curve: MomentCurveView }) {
  const t = useTranslations("patientDetail")
  const momentLabel = t(`meal_${curve.moment}`)
  // Formatteur d'offset i18n (axe + tooltip) — plus de littéral « repas » en dur.
  const fmtOffset = (m: number) =>
    m === 0 ? t("mealOffsetMeal") : t("mealOffsetHours", { h: m / 60 })

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{momentLabel}</h4>
        {!curve.insufficient && (
          <span className="text-xs text-muted-foreground">{t("mealPaired", { n: curve.pairedMeals })}</span>
        )}
      </div>

      {curve.insufficient ? (
        <p role="status" className="py-8 text-center text-xs text-muted-foreground">
          {t("mealInsufficient")}
        </p>
      ) : (
        <>
          {/* Figure déclarée aux lecteurs d'écran ; alternative textuelle
              structurée en table sr-only ci-dessous (WCAG 1.1.1). */}
          <div role="figure" aria-label={t("mealCurveAria", { moment: momentLabel })}>
            <ResponsiveContainer width="100%" height={140}>
              <ComposedChart data={curve.buckets} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={tokens.neutral[200]} />
                <XAxis
                  dataKey="offsetMin" type="number" domain={[-60, 180]}
                  ticks={[-60, 0, 60, 120, 180]} tickFormatter={fmtOffset}
                  stroke={tokens.neutral[500]} tick={{ fontSize: 10 }}
                />
                <YAxis domain={[40, 300]} width={30} stroke={tokens.neutral[500]} tick={{ fontSize: 10 }} />
                {/* Bande cible pathology-aware (bord haut = post-prandial patient). */}
                <ReferenceArea y1={0} y2={curve.targetHighMgdl} fill={tokens.glycemia.normal} fillOpacity={0.08} ifOverflow="extendDomain" />
                {/* Instant du repas. */}
                <ReferenceLine x={0} stroke={tokens.brand.secondary[500]} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="avgMgdl" stroke={tokens.brand.primary[700]} strokeWidth={2} dot={false} connectNulls={false} />
                <Tooltip
                  formatter={(v) => [typeof v === "number" ? `${Math.round(v)} mg/dL` : "—", ""]}
                  labelFormatter={(m) => fmtOffset(m as number)}
                  contentStyle={{ fontSize: 11 }}
                />
              </ComposedChart>
            </ResponsiveContainer>

            {/* Équivalent textuel de la courbe pour lecteurs d'écran. */}
            <table className="sr-only">
              <caption>{t("mealCurveTableCaption", { moment: momentLabel })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("mealColOffset")}</th>
                  <th scope="col">{t("mealColAvg")}</th>
                </tr>
              </thead>
              <tbody>
                {curve.buckets.map((b) => (
                  <tr key={b.offsetMin}>
                    <th scope="row">{fmtOffset(b.offsetMin)}</th>
                    <td>{b.avgMgdl} mg/dL</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {t("mealPrePostPeak", {
              pre: curve.avgPreMgdl ?? "—",
              post: curve.avgPostMgdl ?? "—",
              peak: curve.avgPeakMgdl ?? "—",
            })}
          </p>
          {curve.highExcursion && (
            <p role="status" className="mt-1 rounded-md border border-feedback-warning bg-warning-bg px-2 py-1 text-xs text-warning-fg">
              {t("mealHighExcursion")}
            </p>
          )}
        </>
      )}
    </div>
  )
}
