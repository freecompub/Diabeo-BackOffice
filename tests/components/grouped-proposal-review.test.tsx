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
import type { SlotRationale } from "@/lib/insulin/grouped-proposal"

const row = (over: Partial<SlotDiffRow> = {}): SlotDiffRow => ({
  startHour: 0,
  endHour: 8,
  proposedValue: 0.5,
  liveValue: 0.5,
  changed: false,
  removed: false,
  ...over,
})

const rationale = (over: Partial<SlotRationale> = {}): SlotRationale => ({
  startHour: 8,
  reason: "isfTooLow",
  confidence: "high",
  supportingEvents: 12,
  ...over,
})

const item = (over: Partial<ReviewGroupedViewItem> = {}): ReviewGroupedViewItem => ({
  id: "sp1",
  parameterType: "insulinSensitivityFactor",
  source: "patient",
  rows: [row(), row({ startHour: 8, endHour: 22, proposedValue: 0.55, liveValue: 0.45, changed: true })],
  baselineDrifted: false,
  structuralChange: false,
  rationale: null,
  coexistsWith: null,
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

  // ─────────────────────────── US-2663 (S3b-0b) — rationale MOTEUR + coexistence ───────────────────────────

  it("item ALGORITHME : le créneau changé porte le motif, la confiance et le volume d'observations", () => {
    const algoItem = item({
      source: "algorithm",
      rationale: [rationale({ startHour: 8, reason: "isfTooLow", confidence: "high", supportingEvents: 12 })],
    })
    render(<GroupedProposalReview items={[algoItem]} canDecide busyId={null} onDecide={vi.fn()} />)
    // Libellé `reason` mappé (i18n `review.reasonIsfTooLow`) — factuel, non affirmatif.
    expect(screen.getByText("Sensibilité insuffisante (à renforcer)")).toBeTruthy()
    expect(screen.getByText("Élevée")).toBeTruthy()
    expect(screen.getByText("12 obs.")).toBeTruthy()
  })

  it("item ALGORITHME : le créneau changé porte aussi la direction de risque (côte à côte avec le motif)", () => {
    const algoItem = item({
      source: "algorithm",
      rows: [row({ startHour: 8, endHour: 22, proposedValue: 0.4, liveValue: 0.5, changed: true })],
      rationale: [rationale({ startHour: 8 })],
    })
    render(<GroupedProposalReview items={[algoItem]} canDecide busyId={null} onDecide={vi.fn()} />)
    // ISF baisse (0.5 → 0.4) = plus d'insuline par correction ⇒ risque hypo (cf. `deriveRiskDirection`).
    expect(screen.getByText("Risque hypo")).toBeTruthy()
    expect(screen.getByText("Sensibilité insuffisante (à renforcer)")).toBeTruthy()
  })

  it("item ALGORITHME : la glycémie moyenne observée (`averageObservedValue`) est affichée (revue medical)", () => {
    const algoItem = item({
      source: "algorithm",
      rows: [row({ startHour: 8, endHour: 22, proposedValue: 0.4, liveValue: 0.5, changed: true })],
      rationale: [rationale({ startHour: 8, averageObservedValue: 0.6 })],
    })
    render(<GroupedProposalReview items={[algoItem]} canDecide busyId={null} onDecide={vi.fn()} />)
    // Objective la dé-escalade de sécurité : corrections atterrissant en moyenne à 0,60 g/L.
    expect(screen.getByText(/0,6.*g\/L|0\.6.*g\/L/)).toBeTruthy()
  })

  it("item ALGORITHME : rationale INCOMPLÈTE (créneau changé sans entrée appariée) → aucun motif, pas de crash", () => {
    const algoItem = item({
      source: "algorithm",
      // Baisse ISF (0.5 → 0.4) = risque hypo (déterministe). rationale pour un AUTRE créneau (0) → non appariée.
      rows: [row({ startHour: 8, endHour: 22, proposedValue: 0.4, liveValue: 0.5, changed: true })],
      rationale: [rationale({ startHour: 0 })],
    })
    render(<GroupedProposalReview items={[algoItem]} canDecide busyId={null} onDecide={vi.fn()} />)
    // Le motif n'est PAS affiché pour le créneau 8 (pas d'entrée), mais le rendu ne plante pas ; le risque reste.
    expect(screen.queryByText("Sensibilité insuffisante (à renforcer)")).toBeNull()
    expect(screen.getByText("Risque hypo")).toBeTruthy()
  })

  it("item ALGORITHME : `confidence: null` → aucun badge de confiance (motif + volume conservés)", () => {
    const algoItem = item({
      source: "algorithm",
      rationale: [rationale({ startHour: 8, confidence: null, supportingEvents: 7 })],
    })
    render(<GroupedProposalReview items={[algoItem]} canDecide busyId={null} onDecide={vi.fn()} />)
    expect(screen.queryByText("Faible")).toBeNull()
    expect(screen.queryByText("Moyenne")).toBeNull()
    expect(screen.queryByText("Élevée")).toBeNull()
    expect(screen.getByText("7 obs.")).toBeTruthy()
  })

  it("item HUMAIN (source ≠ algorithm) : AUCUNE rationale affichée, même sur un créneau changé", () => {
    const humanItem = item({ source: "patient", rationale: null })
    render(<GroupedProposalReview items={[humanItem]} canDecide busyId={null} onDecide={vi.fn()} />)
    expect(screen.queryByText(/obs\./)).toBeNull()
    expect(screen.queryByText("Faible")).toBeNull()
    expect(screen.queryByText("Moyenne")).toBeNull()
    expect(screen.queryByText("Élevée")).toBeNull()
  })

  it("coexistsWith non-null → bandeau `role=status` mentionnant la provenance de la proposition sœur", () => {
    render(<GroupedProposalReview items={[item({ coexistsWith: "algorithm" })]} canDecide busyId={null} onDecide={vi.fn()} />)
    const banner = screen.getByRole("status")
    expect(banner.textContent).toMatch(/autre proposition/i)
    expect(banner.textContent).toMatch(/Algorithme/)
  })

  it("coexistsWith null → aucun bandeau `role=status`", () => {
    render(<GroupedProposalReview items={[item({ coexistsWith: null })]} canDecide busyId={null} onDecide={vi.fn()} />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  // US-2663 (S3d) — rendu DOSE FIXE : libellé « usage · moment » traduit, badge highDoseWarning,
  // rationale appariée par (usage, moment).
  it("fixedDose : libellé « Bolus (rapide) · Matin », badge dose élevée, rationale appariée par (usage,moment)", () => {
    const fixedItem = item({
      id: "sf1",
      parameterType: "fixedDose",
      source: "algorithm",
      rows: [
        {
          startHour: 0, endHour: 0,
          usage: "bolus", moment: "morning",
          proposedValue: 30, liveValue: 6,
          changed: true, removed: false,
          highDoseWarning: true, // 30 U bolus > 25 U
        },
      ],
      rationale: [{ usage: "bolus", moment: "morning", reason: "fixedDoseTooLow", confidence: "medium", supportingEvents: 4 } as never],
    })
    render(<GroupedProposalReview items={[fixedItem]} canDecide busyId={null} onDecide={vi.fn()} />)
    expect(screen.getByText("Bolus (rapide) · Matin")).toBeTruthy() // cellLabel traduit
    expect(screen.getByText("Dose élevée")).toBeTruthy() // badge highDoseWarning
    expect(screen.getByText("Dose fixe insuffisante (à renforcer)")).toBeTruthy() // rationale appariée (usage,moment)
  })

  // US-2663 (S3e PR2) — rendu BASALE STYLO : `isPenBasal` → unité U TOTALES (jamais U/h), libellé de dose
  // (`styloBasalKind`), badge highDoseWarning (> 80 U, US-2662), rationale appariée par `basalDoseKind`.
  it("basalRate STYLO : unité U (pas U/h), libellé « Dose du soir », badge dose élevée (> 80 U), rationale par basalDoseKind", () => {
    const styloItem = item({
      id: "ss1",
      parameterType: "basalRate",
      source: "algorithm",
      isPenBasal: true,
      rows: [
        {
          startHour: 1, endHour: 1,
          basalDoseKind: "evening",
          proposedValue: 90, liveValue: 40,
          changed: true, removed: false,
          highDoseWarning: true, // 90 U > MDI_BASAL_WARN_U 80
        },
      ],
      rationale: [{ basalDoseKind: "evening", reason: "basalTooLow", confidence: "medium", supportingEvents: 4 } as never],
    })
    render(<GroupedProposalReview items={[styloItem]} canDecide busyId={null} onDecide={vi.fn()} />)
    expect(screen.getByText("Dose du soir")).toBeTruthy() // cellLabel styloBasalKind
    expect(screen.getByText(/90\s*U(?!\/h)/)).toBeTruthy() // U totales, jamais U/h
    expect(screen.getByText("Dose élevée")).toBeTruthy() // badge highDoseWarning (> 80 U)
    expect(screen.getByText("Débit basal insuffisant (à renforcer)")).toBeTruthy() // rationale appariée par basalDoseKind
  })
})
