/**
 * @vitest-environment jsdom
 */

/** Tests — US-2638 slice B : nuage de points capillaires (`PatientBgmScatter`). */

import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
// recharts stubé (jsdom sans layout) — on teste la sémantique, pas le SVG.
vi.mock("recharts", () => {
  const S = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: S, ScatterChart: S, Scatter: S, XAxis: S, YAxis: S,
    ZAxis: S, CartesianGrid: S, ReferenceArea: S, Tooltip: S,
  }
})

import { PatientBgmScatter } from "@/components/diabeo/patient/PatientBgmScatter"

describe("PatientBgmScatter (US-2638)", () => {
  it("renders a figure with an sr-only textual summary (total + in target)", () => {
    render(
      <PatientBgmScatter
        points={[
          { timeMinutes: 480, mgdl: 120 }, // en cible
          { timeMinutes: 720, mgdl: 260 }, // hors cible
          { timeMinutes: 1080, mgdl: 90 }, // en cible
        ]}
        targetLowMgdl={70}
        targetHighMgdl={180}
      />,
    )
    expect(screen.getByRole("figure")).toBeTruthy()
    // 3 relevés, 2 en cible (120 et 90).
    expect(screen.getByText(/3 relevés capillaires.*dont 2 en cible/)).toBeTruthy()
  })

  it("shows an empty state when there are no readings", () => {
    render(<PatientBgmScatter points={[]} targetLowMgdl={70} targetHighMgdl={180} />)
    expect(screen.getByText(/Aucun relevé capillaire/)).toBeTruthy()
    expect(screen.queryByRole("figure")).toBeNull()
  })
})
