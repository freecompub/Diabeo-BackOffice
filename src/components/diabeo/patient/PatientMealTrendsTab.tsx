"use client"

/**
 * US-2637 — Onglet « Tendances de repas ».
 *
 * 4 mini-courbes glycémiques par moment (alignées sur l'heure du repas) +
 * journal repas (jour × moment × Avant/Après/Glucides/Bolus, **numérique**).
 * Données projetées serveur (`/api/analytics/meal-trends`), pilotées par la
 * période (`usePeriodResource`, lazy). Le texte libre repas n'est jamais exposé.
 */

import { useLocale, useTranslations } from "next-intl"
import { bcp47 } from "@/i18n/config"
import { usePeriodResource } from "./PatientRecordContext"
import { PeriodSelector } from "./PeriodSelector"
import { MealMomentCurve, type MomentCurveView } from "./MealMomentCurve"
import { DAY_MOMENTS, type DayMoment } from "@/lib/day-moments"

const CURVE_ORDER = DAY_MOMENTS
/** Colonnes du journal (les 3 repas principaux ; la nuit est rare au journal). */
const JOURNAL_MOMENTS: DayMoment[] = ["morning", "noon", "evening"]

interface JournalMeal {
  mealId: string
  dayIso: string
  moment: DayMoment
  preMgdl: number | null
  postMgdl: number | null
  carbs: number | null
  bolus: number | null
}
interface MealTrendsData {
  curve: { period: { days: number }; source: "cgm" | "bgm"; moments: MomentCurveView[] }
  journal: JournalMeal[]
}

/**
 * Onglet « Tendances de repas », lazy et piloté par la période.
 *
 * @param props.dataSource - `"cgm"` (défaut) : 4 mini-courbes alignées + journal.
 *   `"bgm"` : fetch `source=bgm` + **carnet avant/après** (journal seul, pas de
 *   courbe interpolée) + bannière capillaire.
 * @returns L'onglet Tendances de repas (états loading/error/empty inclus).
 */
export function PatientMealTrendsTab({ dataSource = "cgm" }: { dataSource?: "cgm" | "bgm" }) {
  const t = useTranslations("patientDetail")
  const locale = useLocale()
  const isBgm = dataSource === "bgm"
  const { data, loading, error } = usePeriodResource<MealTrendsData>({
    endpoint: "/api/analytics/meal-trends",
    map: (raw) => raw as MealTrendsData,
    // BGM : carnet avant/après (journal) sur relevés capillaires — pas de courbe.
    source: isBgm ? "bgm" : undefined,
  })

  const selector = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span id="meal-period-label" className="text-sm font-medium text-muted-foreground">
        {t("periodSelectorLabel")}
      </span>
      <PeriodSelector labelledBy="meal-period-label" />
    </div>
  )

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {selector}
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">{t("mealLoading")}</p>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="space-y-4">
        {selector}
        <p role="alert" className="rounded-md border border-feedback-error bg-error-bg px-4 py-3 text-sm text-error-fg">
          {t("mealError")}
        </p>
      </div>
    )
  }

  const curveByMoment = new Map(data.curve.moments.map((m) => [m.moment, m]))
  // Journal groupé par jour (desc) → { day → { moment → meal } }.
  const days: string[] = []
  const grid = new Map<string, Partial<Record<DayMoment, JournalMeal>>>()
  for (const meal of data.journal) {
    if (!grid.has(meal.dayIso)) {
      grid.set(meal.dayIso, {})
      days.push(meal.dayIso)
    }
    // 1er repas du (jour, moment) conservé (le journal est déjà trié desc).
    const row = grid.get(meal.dayIso)!
    row[meal.moment] ??= meal
  }

  const fmtDay = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(bcp47(locale), {
      weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Paris",
    })
  const cell = (v: number | null) => (v === null ? "—" : String(v))

  return (
    <div className="space-y-6">
      {selector}

      {isBgm ? (
        /* BGM (US-2639) : carnet capillaire avant/après uniquement — pas de
           courbe alignée interpolée (relevés capillaires épars). */
        <p role="status" className="rounded-md border border-feedback-info/25 bg-feedback-info-bg px-4 py-2 text-sm text-feedback-info-fg">
          {t("mealBgmBanner")}
        </p>
      ) : (
        /* Mini-courbes par moment (CGM). */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CURVE_ORDER.map((m) => {
            const c = curveByMoment.get(m)
            return c ? <MealMomentCurve key={m} curve={c} /> : null
          })}
        </div>
      )}

      {/* Journal repas. */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">{t("mealJournalTitle")}</h3>
        {days.length === 0 ? (
          <p role="status" className="py-6 text-center text-sm text-muted-foreground">{t("mealJournalEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("mealJournalCaption")}</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" rowSpan={2} className="py-1 pe-3 text-left align-bottom font-medium">{t("dailyColDay")}</th>
                  {JOURNAL_MOMENTS.map((m) => (
                    <th key={m} id={`mg-${m}`} scope="colgroup" colSpan={4} className="border-s border-border py-1 text-center font-medium">
                      {t(`meal_${m}`)}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  {JOURNAL_MOMENTS.map((m) => (
                    <SubHeaders key={m} t={t} moment={m} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((day) => {
                  const row = grid.get(day)!
                  return (
                    <tr key={day} className="border-b border-border/60 tabular-nums">
                      <th scope="row" className="py-1 pe-3 text-left font-normal text-foreground">{fmtDay(day)}</th>
                      {JOURNAL_MOMENTS.map((m) => (
                        <MomentCells key={m} moment={m} meal={row[m] ?? null} cell={cell} />
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const SUBCOLS = ["before", "after", "carbs", "bolus"] as const

function SubHeaders({ t, moment }: { t: ReturnType<typeof useTranslations>; moment: DayMoment }) {
  const keys = { before: "mealColBefore", after: "mealColAfter", carbs: "mealColCarbs", bolus: "mealColBolus" } as const
  return (
    <>
      {SUBCOLS.map((sc, i) => (
        <th
          key={sc}
          id={`sh-${moment}-${sc}`}
          scope="col"
          className={`px-1 py-1 text-right font-normal${i === 0 ? " border-s border-border" : ""}`}
        >
          {t(keys[sc])}
        </th>
      ))}
    </>
  )
}

/** Cellules d'un moment ; chaque `td` associe le groupe (moment) ET la
 *  sous-colonne via `headers` (WCAG 1.3.1 — tables à en-têtes multi-niveaux). */
function MomentCells({ moment, meal, cell }: { moment: DayMoment; meal: JournalMeal | null; cell: (v: number | null) => string }) {
  const vals: Record<(typeof SUBCOLS)[number], number | null> = {
    before: meal?.preMgdl ?? null, after: meal?.postMgdl ?? null,
    carbs: meal?.carbs ?? null, bolus: meal?.bolus ?? null,
  }
  return (
    <>
      {SUBCOLS.map((sc, i) => (
        <td
          key={sc}
          headers={`mg-${moment} sh-${moment}-${sc}`}
          className={`px-1 py-1 text-right${i === 0 ? " border-s border-border" : ""}${sc === "carbs" || sc === "bolus" ? " text-muted-foreground" : ""}`}
        >
          {cell(vals[sc])}
        </td>
      ))}
    </>
  )
}
