/**
 * @vitest-environment jsdom
 */

/**
 * Tests for Phase 11 Molecule components: DiabeoButton, DiabeoTextField, DiabeoToggle.
 *
 * Clinical safety context: these molecules are used in clinical forms for
 * patient data entry, insulin settings, and RGPD consents. Incorrect states
 * (e.g., button clickable while loading, toggle with wrong aria-checked)
 * could lead to unintended medical data submissions.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { DiabeoTextField } from "@/components/diabeo/DiabeoTextField"
import { DiabeoToggle } from "@/components/diabeo/DiabeoToggle"

// ─── DiabeoButton ────────────────────────────────────────────────────────────

describe("DiabeoButton", () => {
  it("renders children text", () => {
    render(<DiabeoButton>Enregistrer</DiabeoButton>)
    expect(screen.getByText("Enregistrer")).toBeTruthy()
  })

  it("renders as a button element", () => {
    render(<DiabeoButton>Save</DiabeoButton>)
    expect(screen.getByRole("button")).toBeTruthy()
  })

  it("is disabled when loading is true", () => {
    render(<DiabeoButton loading>Saving</DiabeoButton>)
    const button = screen.getByRole("button")
    expect(button.hasAttribute("disabled")).toBe(true)
  })

  it("has aria-busy when loading", () => {
    render(<DiabeoButton loading>Saving</DiabeoButton>)
    const button = screen.getByRole("button")
    expect(button.getAttribute("aria-busy")).toBe("true")
  })

  it("shows a spinner SVG when loading", () => {
    const { container } = render(<DiabeoButton loading>Saving</DiabeoButton>)
    // Loader2 renders an SVG with animate-spin class
    const svg = container.querySelector("svg.animate-spin")
    expect(svg).toBeTruthy()
  })

  it("does not show spinner when not loading", () => {
    const { container } = render(<DiabeoButton>Save</DiabeoButton>)
    const svg = container.querySelector("svg.animate-spin")
    expect(svg).toBeNull()
  })

  it("is disabled when disabled prop is true", () => {
    render(<DiabeoButton disabled>Save</DiabeoButton>)
    const button = screen.getByRole("button")
    expect(button.hasAttribute("disabled")).toBe(true)
  })

  it("calls onClick when clicked", () => {
    const handleClick = vi.fn()
    render(<DiabeoButton onClick={handleClick}>Click me</DiabeoButton>)
    fireEvent.click(screen.getByRole("button"))
    expect(handleClick).toHaveBeenCalledOnce()
  })

  it("does not call onClick when loading", () => {
    const handleClick = vi.fn()
    render(
      <DiabeoButton loading onClick={handleClick}>
        Loading
      </DiabeoButton>
    )
    fireEvent.click(screen.getByRole("button"))
    expect(handleClick).not.toHaveBeenCalled()
  })

  it("renders icon when provided and not loading", () => {
    const icon = <span data-testid="test-icon">I</span>
    render(<DiabeoButton icon={icon}>With icon</DiabeoButton>)
    expect(screen.getByTestId("test-icon")).toBeTruthy()
  })

  it("hides icon and shows spinner when loading", () => {
    const icon = <span data-testid="test-icon">I</span>
    const { container } = render(
      <DiabeoButton icon={icon} loading>
        Loading
      </DiabeoButton>
    )
    expect(screen.queryByTestId("test-icon")).toBeNull()
    expect(container.querySelector("svg.animate-spin")).toBeTruthy()
  })

  it("applies w-full class when fullWidth is true", () => {
    render(<DiabeoButton fullWidth>Full</DiabeoButton>)
    const button = screen.getByRole("button")
    expect(button.classList.contains("w-full")).toBe(true)
  })

  it("applies variant classes for diabeoPrimary", () => {
    render(<DiabeoButton variant="diabeoPrimary">Primary</DiabeoButton>)
    const button = screen.getByRole("button")
    expect(button.classList.contains("bg-teal-600")).toBe(true)
  })

  it("applies variant classes for diabeoDestructive", () => {
    render(<DiabeoButton variant="diabeoDestructive">Delete</DiabeoButton>)
    const button = screen.getByRole("button")
    expect(button.classList.contains("bg-red-500")).toBe(true)
  })
})

// ─── DiabeoTextField ─────────────────────────────────────────────────────────

describe("DiabeoTextField", () => {
  it("renders the label text", () => {
    render(<DiabeoTextField label="Adresse email" />)
    expect(screen.getByText("Adresse email")).toBeTruthy()
  })

  it("renders an input element", () => {
    render(<DiabeoTextField label="Email" />)
    // The label should be associated with the input
    const input = screen.getByRole("textbox")
    expect(input).toBeTruthy()
  })

  it("renders the label with htmlFor matching input id", () => {
    const { container } = render(<DiabeoTextField label="Email" />)
    const label = container.querySelector("label")
    const input = container.querySelector("input")
    expect(label?.getAttribute("for")).toBe(input?.getAttribute("id"))
  })

  it("shows error message when error prop is set", () => {
    render(<DiabeoTextField label="Email" error="Email invalide" />)
    expect(screen.getByText("Email invalide")).toBeTruthy()
  })

  it("error message has role=alert", () => {
    render(<DiabeoTextField label="Email" error="Erreur" />)
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toBe("Erreur")
  })

  it("input has aria-invalid when error is present", () => {
    const { container } = render(
      <DiabeoTextField label="Email" error="Invalid" />
    )
    const input = container.querySelector("input")
    expect(input?.getAttribute("aria-invalid")).toBe("true")
  })

  it("input has aria-describedby pointing to error element", () => {
    const { container } = render(
      <DiabeoTextField label="Email" error="Invalid" />
    )
    const input = container.querySelector("input")
    const errorEl = screen.getByRole("alert")
    expect(input?.getAttribute("aria-describedby")).toBe(errorEl.getAttribute("id"))
  })

  it("shows hint when provided and no error", () => {
    render(<DiabeoTextField label="Email" hint="exemple@mail.com" />)
    expect(screen.getByText("exemple@mail.com")).toBeTruthy()
  })

  it("hides hint when error is present", () => {
    render(
      <DiabeoTextField
        label="Email"
        hint="exemple@mail.com"
        error="Erreur"
      />
    )
    expect(screen.queryByText("exemple@mail.com")).toBeNull()
    expect(screen.getByText("Erreur")).toBeTruthy()
  })

  it("shows required asterisk when required", () => {
    const { container } = render(
      <DiabeoTextField label="Email" required />
    )
    // The asterisk is rendered in a span with aria-hidden
    const asterisk = container.querySelector("[aria-hidden='true']")
    expect(asterisk?.textContent).toBe("*")
  })

  it("input has aria-required when required", () => {
    const { container } = render(
      <DiabeoTextField label="Email" required />
    )
    const input = container.querySelector("input")
    expect(input?.getAttribute("aria-required")).toBe("true")
  })
})

// ─── DiabeoToggle ────────────────────────────────────────────────────────────

describe("DiabeoToggle", () => {
  it("renders the label text", () => {
    render(
      <DiabeoToggle
        label="Notifications"
        checked={false}
        onCheckedChange={() => {}}
      />
    )
    expect(screen.getByText("Notifications")).toBeTruthy()
  })

  it("renders a switch button with role=switch", () => {
    render(
      <DiabeoToggle
        label="Test"
        checked={false}
        onCheckedChange={() => {}}
      />
    )
    expect(screen.getByRole("switch")).toBeTruthy()
  })

  it("has aria-checked=false when unchecked", () => {
    render(
      <DiabeoToggle
        label="Test"
        checked={false}
        onCheckedChange={() => {}}
      />
    )
    const toggle = screen.getByRole("switch")
    expect(toggle.getAttribute("aria-checked")).toBe("false")
  })

  it("has aria-checked=true when checked", () => {
    render(
      <DiabeoToggle
        label="Test"
        checked={true}
        onCheckedChange={() => {}}
      />
    )
    const toggle = screen.getByRole("switch")
    expect(toggle.getAttribute("aria-checked")).toBe("true")
  })

  it("calls onCheckedChange with toggled value on click", () => {
    const handleChange = vi.fn()
    render(
      <DiabeoToggle
        label="Partage"
        checked={false}
        onCheckedChange={handleChange}
      />
    )
    fireEvent.click(screen.getByRole("switch"))
    expect(handleChange).toHaveBeenCalledWith(true)
  })

  it("calls onCheckedChange with false when currently checked", () => {
    const handleChange = vi.fn()
    render(
      <DiabeoToggle
        label="Partage"
        checked={true}
        onCheckedChange={handleChange}
      />
    )
    fireEvent.click(screen.getByRole("switch"))
    expect(handleChange).toHaveBeenCalledWith(false)
  })

  it("does not call onCheckedChange when disabled", () => {
    const handleChange = vi.fn()
    render(
      <DiabeoToggle
        label="Partage"
        checked={false}
        onCheckedChange={handleChange}
        disabled
      />
    )
    fireEvent.click(screen.getByRole("switch"))
    expect(handleChange).not.toHaveBeenCalled()
  })

  it("has aria-disabled when disabled", () => {
    render(
      <DiabeoToggle
        label="Partage"
        checked={false}
        onCheckedChange={() => {}}
        disabled
      />
    )
    const toggle = screen.getByRole("switch")
    expect(toggle.getAttribute("aria-disabled")).toBe("true")
  })

  it("renders subtitle when provided", () => {
    render(
      <DiabeoToggle
        label="Partage"
        subtitle="Autorise votre medecin"
        checked={false}
        onCheckedChange={() => {}}
      />
    )
    expect(screen.getByText("Autorise votre medecin")).toBeTruthy()
  })

  it("toggles on Enter key press", () => {
    const handleChange = vi.fn()
    render(
      <DiabeoToggle
        label="Test"
        checked={false}
        onCheckedChange={handleChange}
      />
    )
    fireEvent.keyDown(screen.getByRole("switch"), { key: "Enter" })
    expect(handleChange).toHaveBeenCalledWith(true)
  })

  it("toggles on Space key press", () => {
    const handleChange = vi.fn()
    render(
      <DiabeoToggle
        label="Test"
        checked={false}
        onCheckedChange={handleChange}
      />
    )
    fireEvent.keyDown(screen.getByRole("switch"), { key: " " })
    expect(handleChange).toHaveBeenCalledWith(true)
  })
})
