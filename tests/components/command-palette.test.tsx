/**
 * @vitest-environment jsdom
 */

/**
 * Tests US-2601 — CommandPalette (Ctrl/Cmd-K).
 *
 * Sécurité / nav : la recherche patient est scopée serveur (route
 * `/api/patients/search`) — ces tests vérifient le câblage UI (ouverture
 * clavier, destinations filtrées par rôle, requête de recherche, navigation),
 * pas le scoping (couvert côté service/route).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

// Dialog base-ui → rendu inline quand `open` (évite portail/focus-trap en jsdom).
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Tooltip base-ui (utilisé par <Acronym>) → rendu enfants.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children, ...p }: React.PropsWithChildren<Record<string, unknown>>) => <span {...p}>{children}</span>,
}))

import { CommandPalette } from "@/components/diabeo/CommandPalette"

function openWithCtrlK() {
  fireEvent.keyDown(document, { key: "k", ctrlKey: true })
}

beforeEach(() => {
  push.mockReset()
  vi.restoreAllMocks()
})

describe("CommandPalette (US-2601)", () => {
  it("is closed initially and opens on Ctrl/Cmd-K", () => {
    render(<CommandPalette userRole="DOCTOR" />)
    expect(screen.queryByTestId("dialog")).toBeNull()
    openWithCtrlK()
    expect(screen.getByTestId("dialog")).toBeTruthy()
  })

  it("shows role-aware destinations (DOCTOR home = « Ma journée »)", () => {
    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    // nav.dashboardMedecin (FR) = « Ma journée » pour le DOCTOR
    expect(screen.getByText("Ma journée")).toBeTruthy()
    expect(screen.getByText("Patients")).toBeTruthy()
  })

  it("filters destinations by the typed query", () => {
    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    const input = screen.getByPlaceholderText("Rechercher un patient ou une section…")
    fireEvent.change(input, { target: { value: "param" } }) // → « Paramètres »
    expect(screen.getByText("Paramètres")).toBeTruthy()
    expect(screen.queryByText("Patients")).toBeNull()
  })

  it("searches patients (server-scoped route) at ≥ 2 chars and navigates on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ id: 42, pathology: "DT1", user: { firstname: "Jean", lastname: "Dupont" } }],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    const input = screen.getByPlaceholderText("Rechercher un patient ou une section…")
    fireEvent.change(input, { target: { value: "Jean Dupont" } })

    const hit = await screen.findByText("Jean Dupont")
    // la route appelée est bien la recherche patient scopée serveur
    expect(fetchMock).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/patients/search?")
    expect(String(fetchMock.mock.calls[0]![0])).toContain("search=Jean+Dupont")

    fireEvent.click(hit)
    expect(push).toHaveBeenCalledWith("/patients/42")
  })

  it("navigates to a destination on click (DOCTOR home → /medecin)", () => {
    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    fireEvent.click(screen.getByText("Ma journée"))
    expect(push).toHaveBeenCalledWith("/medecin")
  })

  it("shows the min-chars hint for a 1-char query", () => {
    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    const input = screen.getByPlaceholderText("Rechercher un patient ou une section…")
    fireEvent.change(input, { target: { value: "x" } })
    expect(screen.getByText("Tapez au moins 2 caractères pour rechercher un patient.")).toBeTruthy()
  })
})
