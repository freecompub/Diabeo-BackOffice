/**
 * @vitest-environment jsdom
 *
 * US-2664 — ProposalList : composant de proposition UNIFIÉ, audience-aware.
 *
 * Comportement clinique testé (frontière MDR, validé medical) :
 * - Rendu **patient** : bandeau « ne modifiez pas vos doses », ton non-prescriptif, et **AUCUN** badge de
 *   decision-support clinicien (dose élevée / risque hypo / % / provenance) ni action — un patient qui verrait
 *   une dose « à appliquer » ou un risque pourrait s'auto-injecter avant validation médecin (ADR #13).
 * - Rendu **clinicien** : badges complets + Accepter/Rejeter si `canDecide` (DOCTOR).
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())

import { ProposalList, type ProposalViewItem } from "@/components/diabeo/patient/ProposalList"

const item = (over: Partial<ProposalViewItem> = {}): ProposalViewItem => ({
  id: "p1", parameterType: "basalRate", source: "patient",
  currentValue: 40, liveCurrentValue: 40, proposedValue: 46,
  changePercent: 15, basalDoseKind: "daily", highDoseWarning: true, ...over,
})

describe("ProposalList — audience PATIENT (sûreté MDR)", () => {
  it("affiche le bandeau « ne modifiez pas vos doses » + la demande (ton non-prescriptif)", () => {
    render(<ProposalList audience="patient" items={[item()]} />)
    expect(screen.getByText(/ne modifiez pas vos doses/i)).toBeTruthy()
    expect(screen.getByText(/Votre demande/i)).toBeTruthy()
  })

  it("n'expose AUCUN badge clinicien (dose élevée / risque / % / provenance) ni bouton de décision", () => {
    render(<ProposalList audience="patient" items={[item({ highDoseWarning: true })]} />)
    expect(screen.queryByText("Dose basale élevée — à confirmer")).toBeNull()
    expect(screen.queryByText("Risque hypo")).toBeNull()
    expect(screen.queryByText("Demande patient")).toBeNull() // badge provenance = clinicien uniquement
    expect(screen.queryByText(/\d+\s*%/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Accepter" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Rejeter" })).toBeNull()
  })
})

describe("ProposalList — audience CLINICIEN", () => {
  it("médecin (canDecide) : badges provenance + dose élevée, Accepter appelle onDecide", () => {
    const onDecide = vi.fn()
    render(<ProposalList audience="clinician" items={[item()]} canDecide onDecide={onDecide} />)
    expect(screen.getByText("Demande patient")).toBeTruthy()
    expect(screen.getByText("Dose basale élevée — à confirmer")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Accepter" }))
    expect(onDecide).toHaveBeenCalledWith("p1", "accept")
  })

  it("infirmière (sans canDecide) : voit les badges mais AUCUN bouton de décision", () => {
    render(<ProposalList audience="clinician" items={[item()]} />)
    expect(screen.getByText("Demande patient")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Accepter" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Rejeter" })).toBeNull()
  })

  it("base dérivée (liveCurrentValue ≠ currentValue) : blocage, badges %/risque masqués, Accepter désactivé", () => {
    render(<ProposalList audience="clinician" items={[item({ liveCurrentValue: 38 })]} canDecide onDecide={vi.fn()} />)
    expect(screen.queryByText(/\+?\d+\s*%/)).toBeNull() // % masqué (périmé)
    expect((screen.getByRole("button", { name: "Accepter" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
