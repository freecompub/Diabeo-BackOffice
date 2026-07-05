/**
 * @vitest-environment jsdom
 */

/**
 * Tests — PatientInsulinView (self-service patient, LECTURE — US-2650).
 *
 * Comportement clinique/sécurité testé :
 * - Mode-aware : configuration présente → créneaux ISF/ICR/basal ; non insuliné
 *   (`hasSettings=false`) → état vide informatif, AUCUNE posologie (AC-4).
 * - Lecture seule stricte : aucun bouton d'action (le patient PROPOSE ailleurs,
 *   jamais d'écriture directe — ADR #13).
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { TreatmentView } from "@/components/diabeo/patient/patient-record-views"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("@/components/diabeo/Acronym", () => ({ Acronym: ({ code }: { code: string }) => <abbr>{code}</abbr> }))
vi.mock("@/components/diabeo/DiabeoEmptyState", () => ({
  DiabeoEmptyState: ({ title, message }: { title: string; message: string }) => (
    <div data-testid="empty">{title} — {message}</div>
  ),
}))

import { PatientInsulinView } from "@/components/diabeo/patient/PatientInsulinView"

const BASE: TreatmentView = {
  hasSettings: true,
  deliveryMethod: "pump",
  bolusInsulin: { name: "Novorapid", genericName: "aspart", dosage: null },
  bolusInconsistent: false,
  pump: null,
  isfSlots: [{ id: "isf1", range: "00:00–08:00", value: 0.5, startHour: 0, endHour: 8 }],
  isfCoverage: { hasGap: false, hasOverlap: false },
  icrSlots: [{ id: "icr1", range: "00:00–24:00", value: 10, startHour: 0, endHour: 24 }],
  icrCoverage: { hasGap: false, hasOverlap: false },
  basalSlots: [{ range: "00:00–24:00", rate: 0.8, pumpBasalSlotId: "b1" }],
  basalCoverage: { hasGap: false, hasOverlap: false },
  treatments: [],
}

describe("PatientInsulinView", () => {
  it("configuration présente : affiche bolus + créneaux ISF/ICR/basal en lecture seule", () => {
    render(<PatientInsulinView data={BASE} />)
    expect(screen.getByText(/Facteur de sensibilité/)).toBeTruthy() // titre ISF
    expect(screen.getByText("Novorapid")).toBeTruthy() // insuline bolus
    expect(screen.getByText("0.5")).toBeTruthy() // valeur créneau ISF
    expect(screen.getByText("10")).toBeTruthy() // valeur créneau ICR
    expect(screen.getByText("0.8")).toBeTruthy() // débit basal
    // Titres de section = vrais h2 (hiérarchie SR, WCAG 1.3.1).
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThanOrEqual(3)
    // Lecture seule stricte : jamais de bouton (proposer/accepter/éditer).
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("sans insuline bolus : la carte bolus est absente", () => {
    render(<PatientInsulinView data={{ ...BASE, bolusInsulin: null }} />)
    expect(screen.queryByText("Novorapid")).toBeNull()
    expect(screen.getByText("0.5")).toBeTruthy() // les créneaux restent affichés
  })

  it("non insuliné (hasSettings=false) : état vide, aucune posologie affichée (AC-4)", () => {
    render(<PatientInsulinView data={{ ...BASE, hasSettings: false }} />)
    expect(screen.getByTestId("empty")).toBeTruthy()
    expect(screen.queryByText("0.5")).toBeNull()
    expect(screen.queryByText("0.8")).toBeNull()
  })
})
