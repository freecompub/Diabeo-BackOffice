/**
 * @vitest-environment jsdom
 */

/**
 * Tests US-2603 — PatientContextBar + PatientSwitcher.
 * Vérifie le câblage UI : drapeaux d'alerte rendus, switcher (récents/épinglés
 * chargés, navigation, bascule épingle). Le scope serveur est couvert ailleurs
 * (recent-patients.service.test.ts + api-patients-pin.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

// next/link → <a> simple.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

// Dialog base-ui → rendu inline quand `open` (évite portail/focus-trap jsdom).
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

import { PatientContextBar } from "@/components/diabeo/patient/PatientContextBar"
import { PatientSwitcher } from "@/components/diabeo/patient/PatientSwitcher"

const NO_FLAGS = { recentHypos: false, hypoCount: 0, silentMonitoring: false, silentDays: null, openUrgency: false }

beforeEach(() => {
  push.mockReset()
  vi.restoreAllMocks()
})

describe("PatientContextBar (US-2603)", () => {
  it("renders identity + back link, no flag chips when none", () => {
    render(
      <PatientContextBar patientId={42} name="Jean Dupont" age={34} pathology="DT1" referent="Dr House" flags={NO_FLAGS} />,
    )
    expect(screen.getByText("Jean Dupont")).toBeTruthy()
    expect(screen.getByLabelText(/Retour à Ma journée/)).toBeTruthy()
    expect(screen.queryByText(/Urgence en cours/)).toBeNull()
    expect(screen.queryByText(/Sans saisie/)).toBeNull()
  })

  it("renders alert-flag chips consistent with « Ma journée »", () => {
    render(
      <PatientContextBar
        patientId={42}
        name="Marie Curie"
        age={50}
        pathology="DT2"
        referent={null}
        flags={{ recentHypos: true, hypoCount: 4, silentMonitoring: true, silentDays: 9, openUrgency: true }}
      />,
    )
    expect(screen.getByText(/Urgence en cours/)).toBeTruthy()
    // Le mock next-intl n'évalue pas le pluriel ICU (rend la chaîne brute) — on
    // vérifie la présence du chip hypo ; le rendu pluriel réel est en prod.
    expect(screen.getByText(/hypo/)).toBeTruthy()
    expect(screen.getByText(/Sans saisie/)).toBeTruthy()
  })
})

describe("PatientSwitcher (US-2603)", () => {
  function stubFetch() {
    const mock = vi.fn((url: string, opts?: { method?: string }) => {
      if (url.startsWith("/api/patients/recent")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            recent: [{ id: 10, publicRef: "r10", name: "Alice Martin", pathology: "DT1" }],
            pinned: [{ id: 20, publicRef: "r20", name: "Bob Durand", pathology: "DT2" }],
          }),
        })
      }
      if (url.includes("/pin")) {
        return Promise.resolve({ ok: true, json: async () => ({ pinned: opts?.method === "POST" }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) })
    })
    vi.stubGlobal("fetch", mock)
    return mock
  }

  it("loads recent + pinned on open and navigates on select", async () => {
    stubFetch()
    render(<PatientSwitcher currentPatientId={99} />)
    fireEvent.click(screen.getByText("Changer de patient"))
    await waitFor(() => expect(screen.getByText("Alice Martin")).toBeTruthy())
    expect(screen.getByText("Bob Durand")).toBeTruthy() // pinned section
    fireEvent.click(screen.getByText("Alice Martin"))
    expect(push).toHaveBeenCalledWith("/patients/10")
  })

  it("toggles pin via the pin endpoint", async () => {
    const fetchMock = stubFetch()
    render(<PatientSwitcher currentPatientId={99} />)
    fireEvent.click(screen.getByText("Changer de patient"))
    await waitFor(() => expect(screen.getByText("Alice Martin")).toBeTruthy())
    // Alice (récente, non épinglée) → bouton « Épingler ».
    fireEvent.click(screen.getAllByLabelText("Épingler")[0]!)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/patients/10/pin", expect.objectContaining({ method: "POST" })),
    )
  })
})
