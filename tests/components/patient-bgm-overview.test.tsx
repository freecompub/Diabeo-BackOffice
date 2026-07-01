/**
 * @vitest-environment jsdom
 */

/**
 * Tests — US-2638 slice B : vue d'ensemble BGM (`PatientBgmOverview`).
 * Garde-fous de libellé (revue #614) : moyenne des relevés (non-eA1c), % en cible
 * distinct du TIR + caveat biais, HbA1c labo datée.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("@/components/diabeo", () => ({
  StatCard: ({ label, value, unit }: { label: string; value: string | number; unit?: string }) => (
    <div data-testid="stat">{label}: {value}{unit ? ` ${unit}` : ""}</div>
  ),
}))

import { PatientBgmOverview } from "@/components/diabeo/patient/PatientBgmOverview"
import { PatientRecordProvider } from "@/components/diabeo/patient/PatientRecordContext"

const BGM = {
  avgMgdl: 145,
  inRangePercent: 58,
  readingsPerDay: 3.2,
  targetRangeMgdl: { low: 70, high: 180 },
  hba1c: { value: 7.4, date: "2026-05-01T00:00:00.000Z", ageDays: 60, stale: false },
  points: [{ timeMinutes: 480, mgdl: 120 }],
}

function renderOverview(bgm = BGM) {
  return render(
    <PatientRecordProvider fetchAnalytics={() => Promise.resolve({ ok: true, json: async () => ({}) } as Response)} seedPeriod="14d">
      <PatientBgmOverview bgm={bgm} />
    </PatientRecordProvider>,
  )
}

describe("PatientBgmOverview (US-2638)", () => {
  it("renders BGM KPIs with guard-rail labels (avg, % in target ≠ TIR, lab HbA1c, frequency)", () => {
    renderOverview()
    const stats = screen.getAllByTestId("stat").map((n) => n.textContent)
    expect(stats.some((s) => s?.includes("Moyenne des relevés") && s?.includes("145 mg/dL"))).toBe(true)
    expect(stats.some((s) => s?.includes("Relevés en cible") && s?.includes("58%"))).toBe(true)
    expect(stats.some((s) => s?.includes("Fréquence") && s?.includes("3.2"))).toBe(true)
    // HbA1c LABO explicité, pas un GMI.
    expect(stats.some((s) => s?.includes("(HbA1c)") && s?.includes("7.4%"))).toBe(true)
    // Bandeau mode capillaire + caveat biais d'échantillonnage.
    expect(screen.getByText(/Mode glycémie capillaire \(BGM\)/)).toBeTruthy()
    expect(screen.getByText(/biais d'échantillonnage/)).toBeTruthy()
  })

  it("flags a stale lab HbA1c value", () => {
    renderOverview({ ...BGM, hba1c: { value: 8.1, date: "2024-01-01T00:00:00.000Z", ageDays: 900, stale: true } })
    expect(screen.getByText(/valeur ancienne/)).toBeTruthy()
  })
})
