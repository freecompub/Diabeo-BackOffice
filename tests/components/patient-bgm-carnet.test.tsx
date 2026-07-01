/**
 * @vitest-environment jsdom
 */

/** Tests — US-2639 : carnet glycémique capillaire (`PatientBgmCarnet`). */

import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("@/components/diabeo", () => ({
  GlycemiaValue: ({ value }: { value: number }) => <span data-testid="glyc">{value}</span>,
}))

import { PatientBgmCarnet } from "@/components/diabeo/patient/PatientBgmCarnet"
import { PatientRecordProvider, type AnalyticsFetcher } from "@/components/diabeo/patient/PatientRecordContext"

const DATA = {
  period: { days: 14 },
  targetRangeMgdl: { low: 70, high: 180 },
  moments: [
    { moment: "morning", count: 5, insufficient: false, avgMgdl: 132 },
    { moment: "noon", count: 4, insufficient: false, avgMgdl: 158 },
    { moment: "evening", count: 2, insufficient: true, avgMgdl: null },
    { moment: "night", count: 0, insufficient: true, avgMgdl: null },
  ],
}
const okJson = (d: unknown): Response => ({ ok: true, json: async () => d }) as unknown as Response

function renderCarnet(fetcher: AnalyticsFetcher) {
  return render(
    <PatientRecordProvider fetchAnalytics={fetcher} seedPeriod="14d">
      <PatientBgmCarnet />
    </PatientRecordProvider>,
  )
}

describe("PatientBgmCarnet (US-2639)", () => {
  it("renders per-moment averages and « données insuffisantes » under the floor", async () => {
    renderCarnet(() => Promise.resolve(okJson(DATA)))
    await waitFor(() => expect(screen.getAllByTestId("glyc").length).toBe(2)) // matin + midi
    const values = screen.getAllByTestId("glyc").map((n) => n.textContent)
    expect(values).toContain("132")
    expect(values).toContain("158")
    // Soir + nuit insuffisants → pas de valeur, message dédié.
    expect(screen.getAllByText("Données insuffisantes").length).toBe(2)
  })

  it("surfaces an error state when the fetch fails", async () => {
    renderCarnet(() => Promise.reject(new Error("boom")))
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
  })
})
