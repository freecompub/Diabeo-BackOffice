/**
 * @vitest-environment jsdom
 */

/**
 * Tests — PatientInsulinView : câblage créneau → cible de proposition (US-2650).
 *
 * Verrou clinique : chaque section doit adresser LE BON créneau avec LE BON paramètre —
 * un swap silencieux (ISF↔ICR, ou basal mal ciblé) enverrait la proposition sur le mauvais
 * réglage. On mocke `InsulinProposalDialog` pour capturer `parameterType`/`target` par section.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { TreatmentView } from "@/components/diabeo/patient/patient-record-views"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("@/components/diabeo/Acronym", () => ({ Acronym: ({ code }: { code: string }) => <abbr>{code}</abbr> }))
vi.mock("@/components/diabeo/DiabeoEmptyState", () => ({ DiabeoEmptyState: () => <div /> }))
// Mock du dialog : expose parameterType + target sérialisé pour assertion du câblage.
vi.mock("@/components/diabeo/patient/InsulinProposalDialog", () => ({
  InsulinProposalDialog: (props: { parameterType: string; target: unknown }) => (
    <button data-testid={`propose-${props.parameterType}`} data-target={JSON.stringify(props.target)}>
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

describe("PatientInsulinView — câblage créneau → cible", () => {
  it("ISF → insulinSensitivityFactor + timeSlot ; ICR → insulinToCarbRatio + timeSlot ; basal → basalRate + pumpSlot", () => {
    render(<PatientInsulinView data={BASE} canPropose />)

    const isf = screen.getByTestId("propose-insulinSensitivityFactor")
    expect(JSON.parse(isf.getAttribute("data-target")!)).toEqual({ kind: "timeSlot", startHour: 0, endHour: 8 })

    const icr = screen.getByTestId("propose-insulinToCarbRatio")
    expect(JSON.parse(icr.getAttribute("data-target")!)).toEqual({ kind: "timeSlot", startHour: 0, endHour: 24 })

    const basal = screen.getByTestId("propose-basalRate")
    expect(JSON.parse(basal.getAttribute("data-target")!)).toEqual({ kind: "pumpSlot", pumpBasalSlotId: "b1" })
  })
})
