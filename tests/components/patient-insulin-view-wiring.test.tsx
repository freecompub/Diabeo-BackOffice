/**
 * @vitest-environment jsdom
 */

/**
 * Tests — PatientInsulinView : câblage section → éditeur de GROUPE en mode PROPOSITION (US-2663 S4).
 *
 * Verrou clinique : chaque section doit ouvrir l'éditeur de groupe du BON levier, en mode `propose`
 * et audience `patient` (own-id → `PUT /api/patient/insulin-slot-set`) — un swap silencieux (ISF↔ICR)
 * ou une audience `pro` (route `POST /api/slot-set-proposals`, refusée au patient) enverrait la
 * proposition sur le mauvais réglage ou la mauvaise route. On mocke les éditeurs de groupe pour
 * capturer leurs props par section.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { TreatmentView } from "@/components/diabeo/patient/patient-record-views"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("@/components/diabeo/Acronym", () => ({ Acronym: ({ code }: { code: string }) => <abbr>{code}</abbr> }))
vi.mock("@/components/diabeo/DiabeoEmptyState", () => ({ DiabeoEmptyState: () => <div /> }))

// Mocks des éditeurs de groupe : exposent param / mode / audience + jeu initial pour assertion.
vi.mock("@/components/diabeo/patient/InsulinSlotSetDialog", () => ({
  InsulinSlotSetDialog: (props: { param: string; mode: string; audience: string; structural?: boolean; initialSlots: unknown }) => (
    <button
      data-testid={`propose-${props.param}`}
      data-mode={props.mode}
      data-audience={props.audience}
      data-structural={String(props.structural)}
      data-slots={JSON.stringify(props.initialSlots)}
    >
      propose
    </button>
  ),
}))
vi.mock("@/components/diabeo/patient/InsulinBasalSlotSetDialog", () => ({
  InsulinBasalSlotSetDialog: (props: { mode: string; audience: string; structural?: boolean; initialSlots: unknown }) => (
    <button
      data-testid="propose-basalRate"
      data-mode={props.mode}
      data-audience={props.audience}
      data-structural={String(props.structural)}
      data-slots={JSON.stringify(props.initialSlots)}
    >
      propose
    </button>
  ),
}))

import { PatientInsulinView } from "@/components/diabeo/patient/PatientInsulinView"

const BASE: TreatmentView = {
  hasSettings: true,
  deliveryMethod: "pump",
  bolusInsulin: null,
  bolusInconsistent: false,
  pump: null,
  isfSlots: [{ id: "isf1", range: "00:00–08:00", value: 0.5, startHour: 0, endHour: 8 }],
  isfCoverage: { hasGap: false, hasOverlap: false },
  icrSlots: [{ id: "icr1", range: "00:00–24:00", value: 10, startHour: 0, endHour: 24 }],
  icrCoverage: { hasGap: false, hasOverlap: false },
  basalSlots: [{ range: "00:00–24:00", rate: 0.8, pumpBasalSlotId: "b1", startTime: "00:00", endTime: "00:00" }],
  basalCoverage: { hasGap: false, hasOverlap: false },
  treatments: [],
}

describe("PatientInsulinView — câblage section → éditeur de groupe (proposition)", () => {
  it("chaque section ouvre le bon levier en mode propose + audience patient, avec son jeu initial", () => {
    render(<PatientInsulinView data={BASE} canPropose />)

    const isf = screen.getByTestId("propose-insulinSensitivityFactor")
    expect(isf.getAttribute("data-mode")).toBe("propose")
    expect(isf.getAttribute("data-audience")).toBe("patient")
    // Valeurs seules côté patient : le serveur refuse la restructuration (`structuralChangeNotAllowed`).
    expect(isf.getAttribute("data-structural")).toBe("false")
    expect(JSON.parse(isf.getAttribute("data-slots")!)).toEqual([{ startHour: 0, endHour: 8, value: 0.5 }])

    const icr = screen.getByTestId("propose-insulinToCarbRatio")
    expect(icr.getAttribute("data-mode")).toBe("propose")
    expect(icr.getAttribute("data-audience")).toBe("patient")
    expect(JSON.parse(icr.getAttribute("data-slots")!)).toEqual([{ startHour: 0, endHour: 24, value: 10 }])

    const basal = screen.getByTestId("propose-basalRate")
    expect(basal.getAttribute("data-mode")).toBe("propose")
    expect(basal.getAttribute("data-audience")).toBe("patient")
    expect(basal.getAttribute("data-structural")).toBe("false")
    expect(JSON.parse(basal.getAttribute("data-slots")!)).toEqual([{ startTime: "00:00", endTime: "00:00", value: 0.8 }])
  })
})
