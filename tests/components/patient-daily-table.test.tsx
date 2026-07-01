/**
 * @vitest-environment jsdom
 */

/**
 * Tests — US-2636 : vue « Tableau journalier » (`PatientDailyTable`) +
 * `ViewSelector` + bascule de vue dans l'onglet AGP.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
// Chart AGP stubé (recharts lourd) — non pertinent pour la vue journalière.
vi.mock("@/components/diabeo/AgpPercentileChart", () => ({
  AgpPercentileChart: () => <div data-testid="agp-chart" />,
}))
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import { PatientDailyTable } from "@/components/diabeo/patient/PatientDailyTable"
import { PatientAgpTab } from "@/components/diabeo/patient/PatientAgpTab"
import {
  PatientRecordProvider,
  type AnalyticsFetcher,
} from "@/components/diabeo/patient/PatientRecordContext"

const DAILY = [
  { day: "2026-07-01", avgMgdl: 150, minMgdl: 70, maxMgdl: 240, count: 288, inTargetPct: 75 },
  { day: "2026-06-30", avgMgdl: 132, minMgdl: 64, maxMgdl: 210, count: 275, inTargetPct: 82 },
]
const okJson = (data: unknown): Response => ({ ok: true, json: async () => data }) as unknown as Response

function renderWith(children: React.ReactNode, fetcher: AnalyticsFetcher) {
  return render(
    <PatientRecordProvider fetchAnalytics={fetcher} seedPeriod="14d">
      {children}
    </PatientRecordProvider>,
  )
}

describe("PatientDailyTable (US-2636)", () => {
  it("renders one row per day with server-projected stats (avg, % in target, min, max, count)", async () => {
    const fetcher: AnalyticsFetcher = () => Promise.resolve(okJson(DAILY))
    renderWith(<PatientDailyTable />, fetcher)
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy())
    expect(screen.getAllByRole("row").length).toBe(3) // header + 2 jours
    expect(screen.getByText("150 mg/dL")).toBeTruthy()
    expect(screen.getByText("75%")).toBeTruthy()
    expect(screen.getByText("82%")).toBeTruthy()
  })

  it("shows the empty state when there is no data for the period", async () => {
    const fetcher: AnalyticsFetcher = () => Promise.resolve(okJson([]))
    renderWith(<PatientDailyTable />, fetcher)
    await waitFor(() => expect(screen.getByText(/Aucune donnée/)).toBeTruthy())
    expect(screen.queryByRole("table")).toBeNull()
  })
})

describe("ViewSelector — bascule Moyenne / Tableau journalier (US-2636)", () => {
  it("switches the AGP tab from the percentile chart to the daily table", async () => {
    const fetcher: AnalyticsFetcher = (endpoint) => {
      if (endpoint.includes("/daily-stats")) return Promise.resolve(okJson(DAILY))
      if (endpoint.includes("/agp")) return Promise.resolve(okJson([{ timeMinutes: 0, p10: 1, p25: 1.1, p50: 1.2, p75: 1.3, p90: 1.4, count: 30 }]))
      return Promise.resolve(okJson({ captureRate: 92, readingCount: 1200, metrics: { averageGlucoseMgdl: 158, gmi: 7.1, coefficientOfVariation: 34, stdDevMgdl: 52 } }))
    }
    renderWith(<PatientAgpTab targetLowMgdl={70} targetHighMgdl={180} />, fetcher)

    // Vue par défaut = Moyenne → chart AGP.
    await screen.findByTestId("agp-chart")
    expect(screen.queryByRole("table")).toBeNull()

    // Bascule vers « Tableau journalier ».
    fireEvent.click(screen.getByRole("radio", { name: "Tableau journalier" }))
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy())
    expect(screen.queryByTestId("agp-chart")).toBeNull()
    expect(screen.getByText("150 mg/dL")).toBeTruthy()
  })
})
