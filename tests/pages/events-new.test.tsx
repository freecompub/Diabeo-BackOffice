/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the New Event page — P0 clinical validation.
 *
 * Clinical safety context:
 * - Glucose values outside 20-600 mg/dL are clinically dangerous to record
 * - Bolus dose > 25 U exceeds CLINICAL_BOUNDS.MAX_SINGLE_BOLUS
 * - Basal dose > 10 U/h exceeds CLINICAL_BOUNDS.BASAL_MAX
 * - HbA1c outside 4.0-14.0 % is clinically implausible
 * - Carbohydrates > 500 g is an extreme outlier
 *
 * @see src/app/(dashboard)/events/new/page.tsx
 * @see src/lib/validators/events.ts — canonical Zod schema
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/events/new"),
  redirect: vi.fn(),
}))

// Mock the Prisma-dependent import so the page module can load in jsdom
vi.mock("@prisma/client", () => ({
  DiabetesEventType: {
    glycemia: "glycemia",
    insulinMeal: "insulinMeal",
    physicalActivity: "physicalActivity",
    context: "context",
    occasional: "occasional",
  },
}))

vi.mock("@/lib/validators/events", () => ({
  // The page only uses the *type* DiabetesEventInput, not a runtime value.
  // Provide a no-op export so the import resolves.
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// ---------------------------------------------------------------------------
// Import page AFTER mocks are registered
// ---------------------------------------------------------------------------

import NewEventPage from "@/app/(dashboard)/events/new/page"
import { useRouter } from "next/navigation"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Click the chip for the given event type key */
function clickChip(typeKey: string) {
  const chip = screen.getByRole("checkbox", { name: `events.types.${typeKey}` })
  fireEvent.click(chip)
}

/** Type a value into a field identified by its translated label key */
async function typeInField(labelPattern: string, value: string) {
  const input = screen.getByLabelText(new RegExp(labelPattern))
  await userEvent.clear(input)
  await userEvent.type(input, value)
}

function submitForm() {
  const saveButton = screen.getByRole("button", { name: /common\.save|events\.saving/i })
  fireEvent.click(saveButton)
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("NewEventPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({}),
    })
  })

  // ── Chip rendering & interaction ────────────────────────────────────────

  it("renders event type chips (5 types)", () => {
    render(<NewEventPage />)

    const chips = screen.getAllByRole("checkbox")
    expect(chips).toHaveLength(5)

    // Verify each event type chip label is present
    expect(screen.getByText("events.types.glycemia")).toBeTruthy()
    expect(screen.getByText("events.types.insulinMeal")).toBeTruthy()
    expect(screen.getByText("events.types.physicalActivity")).toBeTruthy()
    expect(screen.getByText("events.types.context")).toBeTruthy()
    expect(screen.getByText("events.types.occasional")).toBeTruthy()
  })

  it("clicking a chip shows the corresponding section", () => {
    render(<NewEventPage />)

    // Glycemia section should NOT be visible initially
    expect(screen.queryByText("events.sections.glycemia")).toBeNull()

    clickChip("glycemia")

    // Now the glycemia section heading should appear
    expect(screen.getByText("events.sections.glycemia")).toBeTruthy()
  })

  it("clicking multiple chips shows multiple sections", () => {
    render(<NewEventPage />)

    clickChip("glycemia")
    clickChip("insulinMeal")

    expect(screen.getByText("events.sections.glycemia")).toBeTruthy()
    expect(screen.getByText("events.sections.insulinMeal")).toBeTruthy()
  })

  it("deselecting a chip hides the section", () => {
    render(<NewEventPage />)

    clickChip("glycemia")
    expect(screen.getByText("events.sections.glycemia")).toBeTruthy()

    // Click again to deselect
    clickChip("glycemia")
    expect(screen.queryByText("events.sections.glycemia")).toBeNull()
  })

  // ── Glycemia validation ─────────────────────────────────────────────────

  it("glycemia validation: value < 20 shows error", async () => {
    render(<NewEventPage />)
    clickChip("glycemia")

    await typeInField("events\\.fields\\.glycemiaValue", "10")
    submitForm()

    await waitFor(() => {
      expect(screen.getByText("events.errors.glycemiaValueRange")).toBeTruthy()
    })
  })

  it("glycemia validation: value > 600 shows error", async () => {
    render(<NewEventPage />)
    clickChip("glycemia")

    await typeInField("events\\.fields\\.glycemiaValue", "650")
    submitForm()

    await waitFor(() => {
      expect(screen.getByText("events.errors.glycemiaValueRange")).toBeTruthy()
    })
  })

  // ── Bolus validation ────────────────────────────────────────────────────

  it("bolus validation: value > 25 shows error", async () => {
    render(<NewEventPage />)
    clickChip("insulinMeal")

    // Fill required carbs field first
    await typeInField("events\\.fields\\.carbohydrates", "60")
    await typeInField("events\\.fields\\.bolusDose", "30")
    submitForm()

    await waitFor(() => {
      expect(screen.getByText("events.errors.bolusDoseRange")).toBeTruthy()
    })
  })

  // ── Basal validation ────────────────────────────────────────────────────

  it("basal validation: value > 10 shows error", async () => {
    render(<NewEventPage />)
    clickChip("insulinMeal")

    await typeInField("events\\.fields\\.carbohydrates", "60")
    await typeInField("events\\.fields\\.basalDose", "15")
    submitForm()

    await waitFor(() => {
      expect(screen.getByText("events.errors.basalDoseRange")).toBeTruthy()
    })
  })

  // ── HbA1c validation ────────────────────────────────────────────────────

  it("HbA1c validation: value < 4 shows error", async () => {
    render(<NewEventPage />)
    clickChip("occasional")

    await typeInField("events\\.fields\\.hba1c", "3.5")
    submitForm()

    await waitFor(() => {
      expect(screen.getByText("events.errors.hba1cRange")).toBeTruthy()
    })
  })

  it("HbA1c validation: value > 14 shows error", async () => {
    render(<NewEventPage />)
    clickChip("occasional")

    await typeInField("events\\.fields\\.hba1c", "15")
    submitForm()

    await waitFor(() => {
      expect(screen.getByText("events.errors.hba1cRange")).toBeTruthy()
    })
  })

  // ── Carbohydrates validation ────────────────────────────────────────────

  it("carbohydrates validation: value > 500 shows error", async () => {
    render(<NewEventPage />)
    clickChip("insulinMeal")

    await typeInField("events\\.fields\\.carbohydrates", "600")
    submitForm()

    await waitFor(() => {
      expect(screen.getByText("events.errors.carbohydratesMax")).toBeTruthy()
    })
  })

  // ── Form-level validation ───────────────────────────────────────────────

  it("submit with no type selected disables save button", async () => {
    render(<NewEventPage />)

    // When no event types are selected, the save button should be disabled
    const saveButton = screen.getByRole("button", { name: /common\.save|events\.saving/i })
    expect(saveButton.hasAttribute("disabled")).toBe(true)
    expect(saveButton.getAttribute("aria-disabled")).toBe("true")
  })

  // ── Successful submit ───────────────────────────────────────────────────

  it("submit calls fetch with correct payload", async () => {
    render(<NewEventPage />)
    clickChip("glycemia")

    await typeInField("events\\.fields\\.glycemiaValue", "120")
    submitForm()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/events",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      )
    })

    // Verify the payload contains the glycemia value and event types
    const callArgs = mockFetch.mock.calls.find(
      (c: unknown[]) => c[0] === "/api/events"
    )
    expect(callArgs).toBeTruthy()
    const body = JSON.parse(callArgs![1].body)
    expect(body.eventTypes).toContain("glycemia")
    expect(body.glycemiaValue).toBe(120)
  })

  // ── Cancel navigation ───────────────────────────────────────────────────

  it("cancel navigates back", () => {
    const mockBack = vi.fn()
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(),
      back: mockBack,
      forward: vi.fn(),
      refresh: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
    })

    render(<NewEventPage />)

    const cancelButton = screen.getByRole("button", { name: /common\.cancel/i })
    fireEvent.click(cancelButton)

    expect(mockBack).toHaveBeenCalled()
  })

  // ── Comment textarea ────────────────────────────────────────────────────

  it("comment textarea visible when type selected", () => {
    render(<NewEventPage />)

    // No comment section when no types selected
    expect(screen.queryByText("events.sections.comment")).toBeNull()

    clickChip("glycemia")

    // Comment section should now appear
    expect(screen.getByText("events.sections.comment")).toBeTruthy()
    expect(screen.getByLabelText("events.fields.comment")).toBeTruthy()
  })
})
