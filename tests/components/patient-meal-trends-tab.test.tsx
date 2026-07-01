/**
 * @vitest-environment jsdom
 */

/** Tests — US-2637 : onglet « Tendances de repas » (`PatientMealTrendsTab`). */

import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
// Mini-courbe stubée (recharts lourd) : on expose moment + insufficient.
vi.mock("@/components/diabeo/patient/MealMomentCurve", () => ({
  MealMomentCurve: ({ curve }: { curve: { moment: string; insufficient: boolean } }) => (
    <div data-testid={`curve-${curve.moment}`} data-insufficient={curve.insufficient} />
  ),
}))

import { PatientMealTrendsTab } from "@/components/diabeo/patient/PatientMealTrendsTab"
import {
  PatientRecordProvider,
  type AnalyticsFetcher,
} from "@/components/diabeo/patient/PatientRecordContext"

const curve = (moment: string, insufficient = false) => ({
  moment, insufficient, pairedMeals: insufficient ? 1 : 3, buckets: [], avgPreMgdl: 100,
  avgPostMgdl: 150, avgPeakMgdl: 180, targetHighMgdl: 180, highExcursion: false,
})
const DATA = {
  curve: { period: { days: 14 }, source: "cgm", moments: ["morning", "noon", "evening", "night"].map((m) => curve(m, m === "night")) },
  journal: [
    { mealId: "a", dayIso: "2026-07-01", moment: "noon", preMgdl: 100, postMgdl: 150, carbs: 45, bolus: 6 },
    { mealId: "b", dayIso: "2026-06-30", moment: "morning", preMgdl: 90, postMgdl: 140, carbs: 30, bolus: 4 },
  ],
}
const okJson = (d: unknown): Response => ({ ok: true, json: async () => d }) as unknown as Response

function renderTab(fetcher: AnalyticsFetcher) {
  return render(
    <PatientRecordProvider fetchAnalytics={fetcher} seedPeriod="14d">
      <PatientMealTrendsTab />
    </PatientRecordProvider>,
  )
}

describe("PatientMealTrendsTab (US-2637)", () => {
  it("renders the 4 moment curves + a numeric meal journal grouped by day", async () => {
    renderTab(() => Promise.resolve(okJson(DATA)))
    await waitFor(() => expect(screen.getByTestId("curve-noon")).toBeTruthy())
    // 4 mini-courbes ; la nuit marquée insuffisante.
    expect(screen.getByTestId("curve-morning")).toBeTruthy()
    expect(screen.getByTestId("curve-night").getAttribute("data-insufficient")).toBe("true")
    // Journal : table présente, valeurs numériques, aucune colonne texte libre.
    expect(screen.getByRole("table")).toBeTruthy()
    expect(screen.getByText("150")).toBeTruthy() // après midi
    expect(screen.getByText("45")).toBeTruthy() // glucides
  })

  it("shows the empty journal state when no meals", async () => {
    renderTab(() => Promise.resolve(okJson({ ...DATA, journal: [] })))
    await waitFor(() => expect(screen.getByText(/Aucun repas/)).toBeTruthy())
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("surfaces an error state when the fetch fails", async () => {
    renderTab(() => Promise.reject(new Error("boom")))
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
  })
})
