/**
 * @vitest-environment jsdom
 */

/**
 * Tests — InsulinSlotSetDialog : verrou « valeurs seules » côté PATIENT (US-2663 S4).
 *
 * Risque de sécurité/UX : le serveur REFUSE toute restructuration côté patient
 * (`structuralChangeNotAllowed` — un patient édite des doses, il ne re-partitionne pas ses créneaux).
 * L'UI patient (`structural={false}`) NE DOIT donc PAS exposer d'ajout/suppression de créneau ni de
 * champ d'heure éditable — sinon le patient construit une soumission vouée à l'échec. En mode
 * `structural` (défaut, soignant/médecin) ces contrôles restent présents.
 *
 * Le `Dialog` de `components/ui` est mocké (rendu inline quand ouvert) pour éviter le portail Base UI.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { ReactNode } from "react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}))

import { InsulinSlotSetDialog } from "@/components/diabeo/patient/InsulinSlotSetDialog"
import { PatientRecordProvider, type RecordMutator } from "@/components/diabeo/patient/PatientRecordContext"

const BOUNDS = { min: 0.1, max: 1.0 }
// Jeu cohérent 24 h (une seule tranche pleine) — « Valider » n'exige pas de trou/chevauchement.
const FULL_DAY = [{ startHour: 0, endHour: 24, value: 0.5 }]

function renderDialog(structural: boolean) {
  const mutate = vi.fn().mockResolvedValue({ status: 201, json: async () => ({}) } as unknown as Response)
  render(
    <PatientRecordProvider fetchAnalytics={vi.fn()} mutate={mutate as unknown as RecordMutator}>
      <InsulinSlotSetDialog
        param="insulinSensitivityFactor"
        paramLabel="Facteur de sensibilité"
        unit="g/L/U"
        initialSlots={FULL_DAY}
        bounds={BOUNDS}
        mode="propose"
        structural={structural}
      />
    </PatientRecordProvider>,
  )
  fireEvent.click(screen.getByRole("button", { name: /Proposer un ajustement/ }))
  return mutate
}

describe("InsulinSlotSetDialog — valeurs seules (patient)", () => {
  it("structural=false : ni ajout de créneau ni heure éditable (une seule zone de saisie = la valeur)", () => {
    renderDialog(false)
    expect(screen.queryByRole("button", { name: "Ajouter un créneau" })).toBeNull()
    // Une seule zone de saisie : la VALEUR. Les heures sont en lecture (texte).
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
    expect(screen.getByText("00h")).toBeTruthy()
  })

  it("structural=true (défaut soignant) : ajout de créneau + heures éditables", () => {
    renderDialog(true)
    expect(screen.getByRole("button", { name: "Ajouter un créneau" })).toBeTruthy()
    // Début + fin (number) + valeur → au moins 2 spinbuttons (heures) présents.
    expect(screen.getAllByRole("spinbutton").length).toBeGreaterThanOrEqual(2)
  })
})
