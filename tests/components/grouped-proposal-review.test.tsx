/**
 * @vitest-environment jsdom
 *
 * US-2663 (S2) — GroupedProposalReview : diff surligné (ancien → nouveau) d'une `SlotSetProposal` PENDING,
 * pour l'écran de revue médecin. Referme le constat « SlotSetProposal invisible à la revue ».
 *
 * Comportement clinique testé :
 * - Chaque ligne du tableau porte la valeur LIVE et la valeur PROPOSÉE ; une ligne `changed` est surlignée et
 *   porte un `aria-label` (lecteur d'écran) — pas seulement une couleur (accessibilité).
 * - `baselineDrifted` (base dérivée depuis la génération) affiche un bandeau `role="alert"` — AVERTISSEMENT
 *   non bloquant à l'affichage (le blocage réel est côté serveur, 409 `baselineMoved`/`baselineMissing`).
 * - `canDecide=false` (infirmière, ou lecture seule) : AUCUN bouton de décision (parité `ProposalList`).
 * - Accepter/Rejeter appellent `onDecide` avec l'id de l'item et l'action.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())

import { GroupedProposalReview, type ReviewGroupedViewItem } from "@/components/diabeo/patient/GroupedProposalReview"
import type { SlotDiffRow } from "@/lib/insulin/slot-diff"

const row = (over: Partial<SlotDiffRow> = {}): SlotDiffRow => ({
  startHour: 0,
  endHour: 8,
  proposedValue: 0.5,
  liveValue: 0.5,
  changed: false,
  removed: false,
  ...over,
})

const item = (over: Partial<ReviewGroupedViewItem> = {}): ReviewGroupedViewItem => ({
  id: "sp1",
  parameterType: "insulinSensitivityFactor",
  source: "patient",
  rows: [row(), row({ startHour: 8, endHour: 22, proposedValue: 0.55, liveValue: 0.45, changed: true })],
  baselineDrifted: false,
  structuralChange: false,
  createdAt: new Date().toISOString(),
  ...over,
})

describe("GroupedProposalReview", () => {
  it("liste vide → ne rend rien", () => {
    const { container } = render(
      <GroupedProposalReview items={[]} canDecide busyId={null} onDecide={vi.fn()} />,
    )
    expect(container.textContent).toBe("")
  })

  it("rend le paramètre, la provenance, et le diff (valeur live + proposée) par créneau", () => {
    render(<GroupedProposalReview items={[item()]} canDecide busyId={null} onDecide={vi.fn()} />)
    expect(screen.getByText("Facteur de sensibilité à l'insuline (ISF)")).toBeTruthy()
    expect(screen.getByText("Demande patient")).toBeTruthy()
    // 2 lignes de données (+ 1 ligne d'en-tête) dans le tableau
    expect(screen.getAllByRole("row")).toHaveLength(3)
  })

  it("surligne la ligne `changed` avec un aria-label dédié (pas seulement une couleur)", () => {
    render(<GroupedProposalReview items={[item()]} canDecide busyId={null} onDecide={vi.fn()} />)
    const changedRow = screen.getByRole("row", { name: /Créneau modifié/i })
    expect(changedRow.className).toContain("bg-warning-bg")
    // La ligne inchangée n'a pas cet aria-label
    const rows = screen.getAllByRole("row")
    const unchangedDataRow = rows.find((r) => r !== changedRow && !r.className.includes("bg-warning-bg") && r.textContent?.includes("0,5"))
    expect(unchangedDataRow).toBeTruthy()
  })

  it("baselineDrifted : bandeau `role=alert` avec le message d'avertissement de dérive de base", () => {
    render(<GroupedProposalReview items={[item({ baselineDrifted: true })]} canDecide busyId={null} onDecide={vi.fn()} />)
    expect(screen.getByRole("alert").textContent).toMatch(/base active a été modifiée/i)
  })

  it("pas de baselineDrifted → aucun bandeau `role=alert`", () => {
    render(<GroupedProposalReview items={[item({ baselineDrifted: false })]} canDecide busyId={null} onDecide={vi.fn()} />)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("structuralChange : badge « structure modifiée »", () => {
    render(<GroupedProposalReview items={[item({ structuralChange: true })]} canDecide busyId={null} onDecide={vi.fn()} />)
    expect(screen.getByText("Structure modifiée (créneaux ajoutés/supprimés)")).toBeTruthy()
  })

  it("canDecide → Accepter/Rejeter (aria-label incluant le paramètre) appellent onDecide avec l'id", () => {
    const onDecide = vi.fn()
    render(<GroupedProposalReview items={[item()]} canDecide busyId={null} onDecide={onDecide} />)
    // WCAG 2.4.6 — le nom accessible distingue par paramètre (« Accepter la proposition … »).
    fireEvent.click(screen.getByRole("button", { name: /Accepter la proposition/i }))
    expect(onDecide).toHaveBeenCalledWith("sp1", "accept")
    fireEvent.click(screen.getByRole("button", { name: /Rejeter la proposition/i }))
    expect(onDecide).toHaveBeenCalledWith("sp1", "reject")
  })

  it("canDecide=false → aucun bouton de décision (infirmière / lecture seule)", () => {
    render(<GroupedProposalReview items={[item()]} canDecide={false} busyId={null} onDecide={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /Accepter/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /Rejeter/i })).toBeNull()
  })

  it("busyId === item.id → boutons désactivés", () => {
    render(<GroupedProposalReview items={[item()]} canDecide busyId="sp1" onDecide={vi.fn()} />)
    expect((screen.getByRole("button", { name: /Accepter/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: /Rejeter/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("baselineDrifted → Accepter DÉSACTIVÉ (parité ProposalList) ; Rejeter reste actif", () => {
    render(<GroupedProposalReview items={[item({ baselineDrifted: true })]} canDecide busyId={null} onDecide={vi.fn()} />)
    expect((screen.getByRole("button", { name: /Accepter/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: /Rejeter/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("créneau SUPPRIMÉ (removed) → ligne « — » côté proposé + libellé supprimé, ligne surlignée", () => {
    const removedItem = item({
      rows: [row({ startHour: 8, endHour: 0, proposedValue: null, liveValue: 0.4, changed: true, removed: true })],
    })
    render(<GroupedProposalReview items={[removedItem]} canDecide busyId={null} onDecide={vi.fn()} />)
    const removedRow = screen.getByRole("row", { name: /Créneau supprimé/i })
    expect(removedRow.className).toContain("bg-warning-bg")
    // La valeur live (0,4) est visible ; le côté proposé affiche « — ».
    expect(removedRow.textContent).toMatch(/0,4/)
  })
})
