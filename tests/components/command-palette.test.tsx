/**
 * @vitest-environment jsdom
 */

/**
 * Tests US-2601 — CommandPalette (Ctrl/Cmd-K).
 *
 * Sécurité / nav : la recherche patient est scopée serveur (route
 * `/api/patients/search`) — ces tests vérifient le câblage UI (ouverture
 * clavier, destinations filtrées par rôle, filtrage sous-chaîne de la liste de
 * base, recherche exacte de complément, navigation), pas le scoping (couvert
 * côté service/route).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

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

import { CommandPalette } from "@/components/diabeo/CommandPalette"

function openWithCtrlK() {
  fireEvent.keyDown(document, { key: "k", ctrlKey: true })
}

/** Stub fetch renvoyant `items` pour toute requête /api/patients/search. */
function stubFetch(items: unknown[]) {
  const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items }) })
  vi.stubGlobal("fetch", mock)
  return mock
}

beforeEach(() => {
  push.mockReset()
  vi.restoreAllMocks()
  stubFetch([]) // défaut : aucun patient (les tests qui en ont besoin re-stubent)
})

describe("CommandPalette (US-2601)", () => {
  it("is closed initially and opens on Ctrl/Cmd-K", () => {
    render(<CommandPalette userRole="DOCTOR" />)
    expect(screen.queryByTestId("dialog")).toBeNull()
    openWithCtrlK()
    expect(screen.getByTestId("dialog")).toBeTruthy()
  })

  it("lists role-aware destinations from the shared navItems (DOCTOR home = « Ma journée »)", () => {
    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    expect(screen.getByText("Ma journée")).toBeTruthy()
    expect(screen.getByText("Patients")).toBeTruthy()
    expect(screen.getByText("Médicaments")).toBeTruthy() // section absente de l'ancienne liste figée
  })

  it("hides ADMIN-only destinations for a DOCTOR (RBAC gate from navItems)", () => {
    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    // « Audit » est minRole ADMIN → absent pour un DOCTOR
    expect(screen.queryByText("Audit")).toBeNull()
  })

  it("filters destinations by the typed query", () => {
    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    const input = screen.getByPlaceholderText("Rechercher un patient ou une section…")
    fireEvent.change(input, { target: { value: "param" } }) // → « Paramètres »
    expect(screen.getByText("Paramètres")).toBeTruthy()
    expect(screen.queryByText("Patients")).toBeNull()
  })

  it("Option A — substring-filters the base list client-side (typing « Dup » finds « Dupont »)", async () => {
    stubFetch([{ id: 42, pathology: "DT1", user: { firstname: "Jean", lastname: "Dupont" } }])
    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    // laisse le fetch de liste de base se résoudre
    await screen.findByText("Ma journée")
    const input = screen.getByPlaceholderText("Rechercher un patient ou une section…")
    fireEvent.change(input, { target: { value: "Dup" } }) // partiel — pas le nom complet
    const hit = await screen.findByText("Jean Dupont")
    fireEvent.click(hit)
    expect(push).toHaveBeenCalledWith("/patients/42")
  })

  it("fires the server-scoped exact search for ≥ 2 chars", async () => {
    const fetchMock = stubFetch([{ id: 7, pathology: null, user: { firstname: "Marie", lastname: "Martin" } }])
    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    const input = screen.getByPlaceholderText("Rechercher un patient ou une section…")
    fireEvent.change(input, { target: { value: "Martin" } })
    await screen.findByText("Marie Martin")
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes("/api/patients/search?") && u.includes("limit=50"))).toBe(true) // liste de base
    expect(urls.some((u) => u.includes("search=Martin"))).toBe(true) // recherche exacte
  })

  it("navigates to a destination on click (DOCTOR home → /medecin)", () => {
    render(<CommandPalette userRole="DOCTOR" />)
    openWithCtrlK()
    fireEvent.click(screen.getByText("Ma journée"))
    expect(push).toHaveBeenCalledWith("/medecin")
  })
})
