/**
 * @vitest-environment jsdom
 */

/**
 * Tests — US-2635 : onglet AGP (`PatientAgpTab`) + `maskSparseAgpSlots`.
 *
 * Couvre : masquage des slots pauvres (AC-3), transmission de la bande cible
 * **pathology-aware** au chart (AC-2, GD 63–140), libellé GMI non « HbA1c
 * estimée » + infobulle (AC-1), notes de suffisance 7 j / inertie 90 j.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())

// Chart AGP stubé (recharts) : on vérifie seulement les bornes cibles reçues.
vi.mock("@/components/diabeo/AgpPercentileChart", () => ({
  AgpPercentileChart: ({ targetLowMgdl, targetHighMgdl, slots }: { targetLowMgdl: number; targetHighMgdl: number; slots: unknown[] }) => (
    <div data-testid="agp-chart" data-low={targetLowMgdl} data-high={targetHighMgdl} data-slots={slots.length} />
  ),
}))
// Tooltip base-ui stubé (rendu direct du contenu, pas de portail en jsdom).
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, "aria-label": al }: { children: React.ReactNode; "aria-label"?: string }) => <span aria-label={al}>{children}</span>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import { PatientAgpTab, maskSparseAgpSlots } from "@/components/diabeo/patient/PatientAgpTab"
import {
  PatientRecordProvider,
  type AnalyticsFetcher,
  type RecordPeriod,
} from "@/components/diabeo/patient/PatientRecordContext"
import type { AgpSlot } from "@/lib/statistics"

const slot = (count: number, base = 1.2): AgpSlot => ({
  timeMinutes: 0, p10: base - 0.3, p25: base - 0.1, p50: base, p75: base + 0.1, p90: base + 0.3, count,
})

const PROFILE = {
  captureRate: 92,
  readingCount: 1200,
  metrics: { averageGlucoseMgdl: 158, gmi: 7.1, coefficientOfVariation: 34.2, stdDevMgdl: 52 },
}

function okJson(data: unknown): Response {
  return { ok: true, json: async () => data } as unknown as Response
}

function renderTab(opts: { seedPeriod?: RecordPeriod; profile?: object; agpSlots?: AgpSlot[]; low?: number; high?: number } = {}) {
  const fetcher: AnalyticsFetcher = (endpoint) =>
    Promise.resolve(okJson(endpoint.includes("/agp") ? (opts.agpSlots ?? [slot(30)]) : (opts.profile ?? PROFILE)))
  return render(
    <PatientRecordProvider fetchAnalytics={fetcher} seedPeriod={opts.seedPeriod ?? "14d"}>
      <PatientAgpTab targetLowMgdl={opts.low ?? 70} targetHighMgdl={opts.high ?? 180} />
    </PatientRecordProvider>,
  )
}

describe("maskSparseAgpSlots (AC-3)", () => {
  it("collapses the P10–P90 band for slots below the reading floor, keeps others", () => {
    const out = maskSparseAgpSlots([slot(30), slot(2)], 5)
    // Slot riche inchangé.
    expect(out[0].p10).toBe(slot(30).p10)
    expect(out[0].p90).toBe(slot(30).p90)
    // Slot pauvre : p10→p25 et p90→p75 (bande extérieure de largeur nulle).
    expect(out[1].p10).toBe(out[1].p25)
    expect(out[1].p90).toBe(out[1].p75)
    // Médiane préservée.
    expect(out[1].p50).toBe(slot(2).p50)
  })
})

describe("PatientAgpTab (US-2635)", () => {
  it("forwards pathology-aware target bounds to the chart (AC-2 — GD 63–140)", async () => {
    renderTab({ low: 63, high: 140 })
    const chart = await screen.findByTestId("agp-chart")
    expect(chart.getAttribute("data-low")).toBe("63")
    expect(chart.getAttribute("data-high")).toBe("140")
  })

  it("labels GMI with its full name (not « HbA1c estimée ») + a caveat tooltip (AC-1)", async () => {
    renderTab()
    await screen.findByTestId("agp-chart")
    expect(screen.getByText("Indicateur de gestion du glucose (GMI)")).toBeTruthy()
    expect(screen.queryByText(/HbA1c estimée/)).toBeNull()
    // Infobulle caveat ≠ HbA1c labo (rendue par le stub tooltip).
    expect(screen.getByText(/un écart est attendu/)).toBeTruthy()
    expect(screen.getByText("7.1%")).toBeTruthy() // valeur GMI
  })

  it("shows the 7-day indicative caveat (AC-3)", async () => {
    renderTab({ seedPeriod: "7d" })
    await screen.findByTestId("agp-chart")
    await waitFor(() => expect(screen.getByText(/profil indicatif/)).toBeTruthy())
  })

  it("shows the 90-day inertia note (AC-4)", async () => {
    renderTab({ seedPeriod: "90d" })
    await screen.findByTestId("agp-chart")
    await waitFor(() => expect(screen.getByText(/ajustement thérapeutique récent/)).toBeTruthy())
  })

  it("surfaces the low-capture warning when capture < 70 %", async () => {
    renderTab({ profile: { captureRate: 40, readingCount: 100, warning: "insufficientCgmCapture", metrics: PROFILE.metrics } })
    await screen.findByTestId("agp-chart")
    await waitFor(() => expect(screen.getByText(/\(CGM\) insuffisante/)).toBeTruthy())
  })

  it("hides the stats banner when there is no CGM data (readingCount = 0) — no « 0 mg/dL »", async () => {
    renderTab({ profile: { captureRate: 0, readingCount: 0, metrics: { averageGlucoseMgdl: 0, gmi: 0, coefficientOfVariation: 0, stdDevMgdl: 0 } } })
    await screen.findByTestId("agp-chart")
    await waitFor(() =>
      expect(screen.queryByText("Indicateur de gestion du glucose (GMI)")).toBeNull(),
    )
  })

  it("surfaces a re-fetch error banner when the stats endpoint fails (data already shown)", async () => {
    const fetcher: AnalyticsFetcher = (endpoint) =>
      endpoint.includes("/agp")
        ? Promise.resolve(okJson([slot(30)]))
        : Promise.reject(new Error("boom")) // glycemic-profile KO
    render(
      <PatientRecordProvider fetchAnalytics={fetcher} seedPeriod="14d">
        <PatientAgpTab targetLowMgdl={70} targetHighMgdl={180} />
      </PatientRecordProvider>,
    )
    // Le chart (agp) s'affiche, mais l'échec des stats est signalé (jamais muet).
    await screen.findByTestId("agp-chart")
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
  })

  it("shows the AGP error state when the AGP endpoint fails on first load", async () => {
    const fetcher: AnalyticsFetcher = () => Promise.reject(new Error("down"))
    render(
      <PatientRecordProvider fetchAnalytics={fetcher} seedPeriod="14d">
        <PatientAgpTab targetLowMgdl={70} targetHighMgdl={180} />
      </PatientRecordProvider>,
    )
    await waitFor(() => expect(screen.getByText(/Impossible de charger le profil/)).toBeTruthy())
    expect(screen.queryByTestId("agp-chart")).toBeNull()
  })
})
