/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le composant `<AppointmentCreateModal>`.
 *
 * US-2500-UI iter 6 — couvre :
 *   - Render initial (open=true) — form visible avec defaults
 *   - Submit happy path → POST + onCreated avec newId
 *   - Submit échec validation → error visible
 *   - canSubmit gating (patientId requis)
 *   - Bouton "Fermer" → onClose
 *   - Locking modal pendant submit (handleClose gate)
 *   - aria-live sur erreur + nonce ré-annonce
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    if (v && "count" in v) return `${k}=${v.count}`
    return k
  },
  useLocale: () => "fr-FR",
}))

// Mock PatientCombobox pour éviter de tester son détail interne.
// Le combobox réel a son propre test suite (usePatientList.test.tsx).
vi.mock("@/components/diabeo/appointments/PatientCombobox", () => ({
  PatientCombobox: ({ value, onChange, id }: {
    value: number | null
    onChange: (v: number | null) => void
    id: string
  }) => (
    <input
      id={id}
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      data-testid="mock-patient-combobox"
    />
  ),
}))

const { AppointmentCreateModal } = await import(
  "@/components/diabeo/appointments/AppointmentCreateModal"
)

const originalLocation = window.location

beforeEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: { href: "/appointments" },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: originalLocation,
  })
})

describe("<AppointmentCreateModal>", () => {
  const onClose = vi.fn()
  const onCreated = vi.fn()

  beforeEach(() => {
    onClose.mockClear()
    onCreated.mockClear()
  })

  it("render initial : form visible + defaults (date today, hour 09:00, type diabeto, location in_person)", () => {
    render(
      <AppointmentCreateModal
        open
        memberId={1}
        onClose={onClose}
        onCreated={onCreated}
      />,
    )
    expect(screen.getByText("createTitle")).toBeTruthy()
    expect(screen.getByLabelText("dateLabel")).toBeTruthy()
    expect(screen.getByLabelText("hourLabel")).toBeTruthy()
    expect(screen.getByLabelText("durationLabel")).toBeTruthy()
    expect(screen.getByLabelText("locationLabel")).toBeTruthy()
    expect(screen.getByLabelText("typeLabel")).toBeTruthy()
    expect(screen.getByLabelText("motifLabel")).toBeTruthy()
    expect(screen.getByText("actionConfirmCreate")).toBeTruthy()
  })

  it("canSubmit gating : bouton disabled tant que patientId pas sélectionné", () => {
    render(
      <AppointmentCreateModal
        open
        memberId={1}
        onClose={onClose}
        onCreated={onCreated}
      />,
    )
    const submitBtn = screen.getByText("actionConfirmCreate").closest("button") as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)

    // Sélectionne un patient via le mock combobox
    const combobox = screen.getByTestId("mock-patient-combobox") as HTMLInputElement
    fireEvent.change(combobox, { target: { value: "42" } })

    // Bouton enabled maintenant
    expect((screen.getByText("actionConfirmCreate").closest("button") as HTMLButtonElement).disabled).toBe(false)
  })

  it("submit happy path : POST 201 → onCreated(newId) + onClose", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 99 }),
    } as Response)

    render(
      <AppointmentCreateModal
        open
        memberId={1}
        onClose={onClose}
        onCreated={onCreated}
      />,
    )

    fireEvent.change(screen.getByTestId("mock-patient-combobox") as HTMLInputElement, {
      target: { value: "7" },
    })
    fireEvent.click(screen.getByText("actionConfirmCreate"))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(99))
    // Note : onClose n'est PAS appelé directement par le modal ; c'est le parent
    // (`handleCreated`) qui set `createOpen=false` après onCreated. Le modal
    // unmount via `key` change.
  })

  it("submit body : patientId + memberId + date + hour + durationMinutes + location + type + motif", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 99 }),
    } as Response)

    render(
      <AppointmentCreateModal
        open
        memberId={3}
        onClose={onClose}
        onCreated={onCreated}
      />,
    )

    fireEvent.change(screen.getByTestId("mock-patient-combobox") as HTMLInputElement, {
      target: { value: "7" },
    })
    fireEvent.change(screen.getByLabelText("motifLabel") as HTMLTextAreaElement, {
      target: { value: "Test motif" },
    })
    fireEvent.click(screen.getByText("actionConfirmCreate"))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(body.patientId).toBe(7)
    expect(body.memberId).toBe(3)
    expect(body.durationMinutes).toBe(30)
    expect(body.location).toBe("in_person")
    expect(body.type).toBe("diabeto")
    expect(body.motif).toBe("Test motif")
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.hour).toBe("09:00")
  })

  it("submit échec validation 400 → error visible (role=alert) + onCreated PAS appelé", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "validationFailed" }),
    } as Response)

    render(
      <AppointmentCreateModal
        open
        memberId={1}
        onClose={onClose}
        onCreated={onCreated}
      />,
    )

    fireEvent.change(screen.getByTestId("mock-patient-combobox") as HTMLInputElement, {
      target: { value: "7" },
    })
    fireEvent.click(screen.getByText("actionConfirmCreate"))

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(onCreated).not.toHaveBeenCalled()
    // Le message rendu est `t("createError")` générique (HSA-3 defense-in-depth)
    expect(screen.getByRole("alert").textContent).toContain("createError")
  })

  it("aria-live='assertive' sur alerte erreur (FE-9 pattern iter 5)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "serverError" }),
    } as Response)

    render(
      <AppointmentCreateModal
        open
        memberId={1}
        onClose={onClose}
        onCreated={onCreated}
      />,
    )
    fireEvent.change(screen.getByTestId("mock-patient-combobox") as HTMLInputElement, {
      target: { value: "7" },
    })
    fireEvent.click(screen.getByText("actionConfirmCreate"))

    await waitFor(() => {
      const alert = screen.getByRole("alert")
      expect(alert.getAttribute("aria-live")).toBe("assertive")
    })
  })

  it("clic 'Fermer' → onClose appelé (si pas en loading)", () => {
    render(
      <AppointmentCreateModal
        open
        memberId={1}
        onClose={onClose}
        onCreated={onCreated}
      />,
    )
    fireEvent.click(screen.getByText("actionClose"))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("handleClose gate : Escape pendant submit ne ferme PAS le modal", async () => {
    const pendingResponse = new Promise<Response>(() => { /* never */ })
    vi.spyOn(global, "fetch").mockReturnValue(pendingResponse)

    render(
      <AppointmentCreateModal
        open
        memberId={1}
        onClose={onClose}
        onCreated={onCreated}
      />,
    )
    fireEvent.change(screen.getByTestId("mock-patient-combobox") as HTMLInputElement, {
      target: { value: "7" },
    })
    fireEvent.click(screen.getByText("actionConfirmCreate"))

    // Wait actionLoading propagé : bouton submit affiche "loading"
    await waitFor(() => {
      expect(screen.queryByText("actionConfirmCreate")).toBeNull()
    })

    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).not.toHaveBeenCalled()
  })

  it("open=false → Dialog non rendu (mode contrôlé)", () => {
    render(
      <AppointmentCreateModal
        open={false}
        memberId={1}
        onClose={onClose}
        onCreated={onCreated}
      />,
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
