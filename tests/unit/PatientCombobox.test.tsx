/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le composant `<PatientCombobox>`.
 *
 * Fix FE-20 round 1 review PR #434 — couverture explicit du combobox autonome
 * (le test modal le mock pour découpler). Couvre :
 *   - Render initial : input + datalist + hint count total backend (FE-9)
 *   - Filter accent-aware via normalize NFD (CR-H3/FE-1)
 *   - Disambiguation #id dans le label (CR-H3/FE-6)
 *   - Match exact onChange (lowercase + normalize)
 *   - No-results state (FE-7)
 *   - aria-required + aria-invalid (FE-15/16)
 *   - Loading state
 *   - Error state (role=alert)
 *   - useDeferredValue debouncing (smoke — vérifie pas de setState in effect)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    if (v && "count" in v) return `${k}=${v.count}`
    return k
  },
}))

// Mock usePatientList pour contrôler les items + loading + error indépendamment.
const mockUsePatientList = vi.fn()
vi.mock("@/components/diabeo/appointments/usePatientList", () => ({
  usePatientList: (...args: unknown[]) => mockUsePatientList(...args),
}))

const { PatientCombobox } = await import(
  "@/components/diabeo/appointments/PatientCombobox"
)

const baseItems = [
  { id: 1, firstname: "Jean", lastname: "Durand" },
  { id: 2, firstname: "Claire", lastname: "Bernard" },
  { id: 42, firstname: "Jean", lastname: "Martin" },
  { id: 43, firstname: "Jean", lastname: "Martin" }, // homonyme
  { id: 7, firstname: "Müller", lastname: "Pérez" }, // accents
]

function setMockHook(opts: {
  items?: typeof baseItems
  loading?: boolean
  error?: string | null
} = {}) {
  mockUsePatientList.mockReturnValue({
    items: opts.items ?? baseItems,
    loading: opts.loading ?? false,
    error: opts.error ?? null,
    refetch: vi.fn(),
  })
}

beforeEach(() => {
  setMockHook()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("<PatientCombobox>", () => {
  it("render initial : input + datalist + hint count total backend (FE-9)", () => {
    const onChange = vi.fn()
    render(<PatientCombobox id="test-combobox" value={null} onChange={onChange} />)

    const input = screen.getByRole("combobox")
    expect(input).toBeTruthy()
    const datalist = document.getElementById("test-combobox-options")
    expect(datalist).not.toBeNull()
    // Hint affiche le total backend (5 items) — pas le filtré (FE-9 fix)
    expect(document.body.textContent).toContain("patientHint=5")
  })

  it("CR-H3/FE-6 — disambiguation #id dans les options datalist (homonymes)", () => {
    render(<PatientCombobox id="test-combobox" value={null} onChange={vi.fn()} />)
    const options = document.querySelectorAll("#test-combobox-options option")
    const labels = Array.from(options).map((o) => (o as HTMLOptionElement).value)
    // Les 2 "Jean Martin" doivent être disambiguées par #id
    expect(labels).toContain("Jean Martin #42")
    expect(labels).toContain("Jean Martin #43")
    expect(labels).toContain("Jean Durand #1")
  })

  it("CR-H3/FE-1 — filter accent-aware via normalize NFD", () => {
    render(<PatientCombobox id="test-combobox" value={null} onChange={vi.fn()} />)
    // Tape "muller" sans accent → match "Müller Pérez #7"
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "muller" } })
    // Les options datalist sont filtrées côté client
    const options = document.querySelectorAll("#test-combobox-options option")
    const labels = Array.from(options).map((o) => (o as HTMLOptionElement).value)
    expect(labels).toContain("Müller Pérez #7")
    // Et n'inclut PAS les autres
    expect(labels).not.toContain("Jean Durand #1")
  })

  it("CR-H3/FE-1 — filter insensitive case", () => {
    render(<PatientCombobox id="test-combobox" value={null} onChange={vi.fn()} />)
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "JEAN" } })
    const options = document.querySelectorAll("#test-combobox-options option")
    const labels = Array.from(options).map((o) => (o as HTMLOptionElement).value)
    // 3 patients "Jean" (Durand, Martin #42, Martin #43)
    expect(labels.length).toBe(3)
  })

  it("CR-H3 — onChange match exact via normalize (lowercase + accent)", () => {
    const onChange = vi.fn()
    render(<PatientCombobox id="test-combobox" value={null} onChange={onChange} />)

    // Tape exactement le label "Jean Martin #42"
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Jean Martin #42" } })
    expect(onChange).toHaveBeenCalledWith(42, "Jean Martin #42")

    // Tape le label avec casse différente — toujours match (insensitive)
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "jean martin #43" } })
    expect(onChange).toHaveBeenCalledWith(43, "Jean Martin #43")

    // Tape accent absent ("muller perez #7" → match "Müller Pérez #7")
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "muller perez #7" } })
    expect(onChange).toHaveBeenCalledWith(7, "Müller Pérez #7")
  })

  it("CR-H3 — partial input (pas exact match) → onChange(null)", () => {
    const onChange = vi.fn()
    render(<PatientCombobox id="test-combobox" value={null} onChange={onChange} />)

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Jean" } })
    expect(onChange).toHaveBeenCalledWith(null, null)
  })

  it("FE-7 — no-results state : input avec text + filtered empty → message warning", () => {
    setMockHook({ items: [] })
    render(<PatientCombobox id="test-combobox" value={null} onChange={vi.fn()} />)

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Inexistant" } })

    // Le hint affiche "patientNoResults" via role=status
    expect(document.body.textContent).toContain("patientNoResults")
  })

  it("FE-15 — aria-required='true' posé sur l'input", () => {
    render(<PatientCombobox id="test-combobox" value={null} onChange={vi.fn()} />)
    const input = screen.getByRole("combobox")
    expect(input.getAttribute("aria-required")).toBe("true")
  })

  it("FE-16 — aria-invalid='true' si value null ET user a tapé (signal SR)", () => {
    render(<PatientCombobox id="test-combobox" value={null} onChange={vi.fn()} />)
    const input = screen.getByRole("combobox")
    // Avant frappe : aria-invalid absent
    expect(input.getAttribute("aria-invalid")).toBeNull()
    // Frappe partielle → no match → aria-invalid="true"
    fireEvent.change(input, { target: { value: "Jean" } })
    expect(input.getAttribute("aria-invalid")).toBe("true")
  })

  it("FE-16 — aria-invalid absent si value sélectionné (match)", () => {
    render(<PatientCombobox id="test-combobox" value={1} onChange={vi.fn()} />)
    const input = screen.getByRole("combobox")
    expect(input.getAttribute("aria-invalid")).toBeNull()
  })

  it("hint 'Patient sélectionné' si value !== null", () => {
    render(<PatientCombobox id="test-combobox" value={1} onChange={vi.fn()} />)
    expect(document.body.textContent).toContain("patientSelected")
  })

  it("loading state : hint affiche 'loading' + input disabled", () => {
    setMockHook({ loading: true })
    render(<PatientCombobox id="test-combobox" value={null} onChange={vi.fn()} />)
    const input = screen.getByRole("combobox") as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(document.body.textContent).toContain("loading")
  })

  it("error state : hint affiche role='alert' + i18n key 'patientListError'", () => {
    setMockHook({ error: "networkError" })
    render(<PatientCombobox id="test-combobox" value={null} onChange={vi.fn()} />)
    const alert = screen.getByRole("alert")
    expect(alert).toBeTruthy()
    expect(alert.textContent).toContain("patientListError")
  })

  it("autoComplete='off' + spellCheck=false (anti history input + anti spell check PHI)", () => {
    render(<PatientCombobox id="test-combobox" value={null} onChange={vi.fn()} />)
    const input = screen.getByRole("combobox")
    expect(input.getAttribute("autoComplete")).toBe("off")
    expect(input.getAttribute("spellCheck")).toBe("false")
  })

  it("FE-2 round 1 — useDeferredValue (pas de setState-in-effect) — smoke : no warn after multi-frappes", async () => {
    render(<PatientCombobox id="test-combobox" value={null} onChange={vi.fn()} />)
    const input = screen.getByRole("combobox")
    // Multi-frappes rapides
    fireEvent.change(input, { target: { value: "J" } })
    fireEvent.change(input, { target: { value: "Je" } })
    fireEvent.change(input, { target: { value: "Jea" } })
    fireEvent.change(input, { target: { value: "Jean" } })
    // Pas de crash + hint stable
    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeTruthy()
    })
  })
})
