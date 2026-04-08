/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the Insulin Therapy Settings page — P1 ISF/ICR clinical bounds.
 *
 * Clinical safety context:
 * - ISF (Insulin Sensitivity Factor) range: 0.20-1.00 g/L/U
 * - ICR (Insulin-to-Carb Ratio) range: 5-20 g/U
 * - Target glucose range: 60-250 mg/dL
 * - Values outside these ranges could lead to dangerous insulin dosing
 *
 * @see src/app/(dashboard)/insulin-therapy/page.tsx
 * @see CLAUDE.md — CLINICAL_BOUNDS
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/insulin-therapy"),
  redirect: vi.fn(),
}))

// Mock Dialog to render children directly (avoids portal issues in jsdom)
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

// Mock Select to render children directly
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange, value }: { children: React.ReactNode; onValueChange?: (v: string) => void; value?: string }) => (
    <div data-testid="select" data-value={value}>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  SelectValue: () => null,
}))

// Mock Slider to render a simple range input
vi.mock("@/components/ui/slider", () => ({
  Slider: (props: { value: number; onValueChange?: (v: number) => void; min?: number; max?: number; "aria-label"?: string }) => (
    <input
      type="range"
      role="slider"
      aria-label={props["aria-label"]}
      min={props.min}
      max={props.max}
      value={props.value}
      onChange={(e) => props.onValueChange?.(parseInt(e.target.value, 10))}
    />
  ),
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// ---------------------------------------------------------------------------
// Import page AFTER mocks
// ---------------------------------------------------------------------------

import InsulinTherapyPage from "@/app/(dashboard)/insulin-therapy/page"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock API responses for the three parallel fetches */
function setupFetchMocks(overrides?: {
  settings?: Record<string, unknown>
  isf?: unknown[]
  icr?: unknown[]
}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/settings")) {
      return Promise.resolve({
        ok: true,
        json: async () => overrides?.settings ?? {
          bolusInsulinBrand: "novorapid",
          basalInsulinBrand: "lantus",
          insulinActionDuration: 240,
          targetGlucoseMgdl: 100,
          considerIob: true,
          extendedBolusEnabled: false,
          extendedBolusPercent: 50,
          extendedBolusDurationMin: 60,
        },
      })
    }
    if (url.includes("/sensitivity-factors")) {
      return Promise.resolve({
        ok: true,
        json: async () => overrides?.isf ?? [],
      })
    }
    if (url.includes("/carb-ratios")) {
      return Promise.resolve({
        ok: true,
        json: async () => overrides?.icr ?? [],
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

async function renderAndWaitForLoad() {
  setupFetchMocks()
  await act(async () => {
    render(<InsulinTherapyPage />)
  })
  // Wait for loading to complete (the spinner disappears)
  await waitFor(() => {
    expect(screen.getByText("insulinTherapy.basicParameters")).toBeTruthy()
  })
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("InsulinTherapyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Section rendering ───────────────────────────────────────────────────

  it("renders basic parameters section", async () => {
    await renderAndWaitForLoad()

    expect(screen.getByText("insulinTherapy.basicParameters")).toBeTruthy()
    expect(screen.getByText("insulinTherapy.basicParametersDescription")).toBeTruthy()
  })

  it("renders ISF section header", async () => {
    await renderAndWaitForLoad()

    expect(screen.getByText("insulinTherapy.isf.title")).toBeTruthy()
    expect(screen.getByText("insulinTherapy.isf.description")).toBeTruthy()
  })

  it("renders ICR section header", async () => {
    await renderAndWaitForLoad()

    expect(screen.getByText("insulinTherapy.icr.title")).toBeTruthy()
    expect(screen.getByText("insulinTherapy.icr.description")).toBeTruthy()
  })

  // ── Target glucose NaN protection ──────────────────────────────────────

  it("target glucose NaN protection (empty input -> 0, not NaN)", async () => {
    await renderAndWaitForLoad()

    // Find the target glucose input by its label
    const targetInput = screen.getByLabelText("insulinTherapy.targetGlucose")
    expect(targetInput).toBeTruthy()

    // Clear the input — the component converts "" to 0, then clamps to 60
    fireEvent.change(targetInput, { target: { value: "" } })

    // The value should be clamped to 60 (min bound), not NaN
    await waitFor(() => {
      expect((targetInput as HTMLInputElement).value).not.toBe("NaN")
    })
  })

  it("target glucose clamped to 60-250", async () => {
    await renderAndWaitForLoad()

    const targetInput = screen.getByLabelText("insulinTherapy.targetGlucose")

    // Try setting value below minimum
    fireEvent.change(targetInput, { target: { value: "30" } })
    await waitFor(() => {
      const val = parseInt((targetInput as HTMLInputElement).value, 10)
      expect(val).toBeGreaterThanOrEqual(60)
    })

    // Try setting value above maximum
    fireEvent.change(targetInput, { target: { value: "400" } })
    await waitFor(() => {
      const val = parseInt((targetInput as HTMLInputElement).value, 10)
      expect(val).toBeLessThanOrEqual(250)
    })
  })

  // ── ISF slot validation ─────────────────────────────────────────────────

  it("ISF slot validation: value < 0.20 shows error", async () => {
    await renderAndWaitForLoad()

    // Open the ISF add slot dialog
    const addIsfButton = screen.getByText("insulinTherapy.isf.addSlot")
    fireEvent.click(addIsfButton)

    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeTruthy()
    })

    // Enter an ISF value below the minimum
    const valueInput = screen.getByLabelText("insulinTherapy.isf.valueLabel")
    await userEvent.clear(valueInput)
    await userEvent.type(valueInput, "0.10")

    // Click confirm
    const confirmButton = screen.getByText("common.confirm")
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(screen.getByText("insulinTherapy.isfValueError")).toBeTruthy()
    })
  })

  it("ISF slot validation: value > 1.00 shows error", async () => {
    await renderAndWaitForLoad()

    const addIsfButton = screen.getByText("insulinTherapy.isf.addSlot")
    fireEvent.click(addIsfButton)

    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeTruthy()
    })

    const valueInput = screen.getByLabelText("insulinTherapy.isf.valueLabel")
    await userEvent.clear(valueInput)
    await userEvent.type(valueInput, "1.50")

    const confirmButton = screen.getByText("common.confirm")
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(screen.getByText("insulinTherapy.isfValueError")).toBeTruthy()
    })
  })

  // ── ICR slot validation ─────────────────────────────────────────────────

  it("ICR slot validation: value < 5 shows error", async () => {
    await renderAndWaitForLoad()

    const addIcrButton = screen.getByText("insulinTherapy.icr.addSlot")
    fireEvent.click(addIcrButton)

    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeTruthy()
    })

    const valueInput = screen.getByLabelText("insulinTherapy.icr.valueLabel")
    await userEvent.clear(valueInput)
    await userEvent.type(valueInput, "3")

    const confirmButton = screen.getByText("common.confirm")
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(screen.getByText("insulinTherapy.icrValueError")).toBeTruthy()
    })
  })

  it("ICR slot validation: value > 20 shows error", async () => {
    await renderAndWaitForLoad()

    const addIcrButton = screen.getByText("insulinTherapy.icr.addSlot")
    fireEvent.click(addIcrButton)

    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toBeTruthy()
    })

    const valueInput = screen.getByLabelText("insulinTherapy.icr.valueLabel")
    await userEvent.clear(valueInput)
    await userEvent.type(valueInput, "25")

    const confirmButton = screen.getByText("common.confirm")
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(screen.getByText("insulinTherapy.icrValueError")).toBeTruthy()
    })
  })

  // ── Save button state ───────────────────────────────────────────────────

  it("save button disabled when no changes", async () => {
    await renderAndWaitForLoad()

    const saveButton = screen.getByText("common.save")
    expect(saveButton.closest("button")?.disabled).toBe(true)
  })

  // ── Advanced settings ───────────────────────────────────────────────────

  it("advanced settings toggle shows IOB option", async () => {
    await renderAndWaitForLoad()

    expect(screen.getByText("insulinTherapy.advanced.title")).toBeTruthy()

    // The IOB toggle should be present
    const iobToggle = screen.getByText("insulinTherapy.advanced.considerIob")
    expect(iobToggle).toBeTruthy()

    // The extended bolus toggle should also be present
    expect(screen.getByText("insulinTherapy.advanced.extendedBolus")).toBeTruthy()
  })
})
