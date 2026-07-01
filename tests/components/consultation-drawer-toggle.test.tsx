/**
 * @vitest-environment jsdom
 */

/**
 * Tests — US-2640 : bouton « ouvrir en page » du drawer de consultation.
 * AC-1 : la bascule navigue vers la route page autorisée `/patients/[id]`
 * (id du DTO résolu serveur) et ferme le drawer ; aucun id n'est en URL tant
 * qu'on est en drawer (le bouton n'apparaît qu'une fois le dossier chargé).
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())

const useConsultationData = vi.fn()
vi.mock("@/components/diabeo/consultation/useConsultationData", () => ({
  useConsultationData: (...a: unknown[]) => useConsultationData(...a),
}))
vi.mock("@/components/diabeo/patient/PatientRecord", () => ({
  PatientRecord: () => <div data-testid="patient-record" />,
}))
vi.mock("@/components/diabeo/patient/PatientRecordContext", () => ({
  PatientRecordProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/diabeo/patient/PatientAlertFlags", () => ({ PatientAlertFlags: () => <div /> }))

import { PatientConsultationDrawer } from "@/components/diabeo/consultation/PatientConsultationDrawer"

const patient = { publicRef: "ref-42", name: "Jean Dupont", pathology: "DT1" as const, age: 34 }

function renderDrawer(onClose = vi.fn()) {
  render(
    <PatientConsultationDrawer
      patient={patient}
      cTok="tok-abc"
      expanded={false}
      onClose={onClose}
      onToggleExpanded={vi.fn()}
    />,
  )
  return { onClose }
}

describe("PatientConsultationDrawer — toggle to page (US-2640)", () => {
  it("navigates to the authorized page route by DTO id and closes the drawer", () => {
    useConsultationData.mockReturnValue({ data: { id: 42, flags: {} }, loading: false, error: false })
    const { onClose } = renderDrawer()
    fireEvent.click(screen.getByLabelText("Ouvrir en page plein écran"))
    expect(onClose).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith("/patients/42")
  })

  it("hides the toggle while the record is still loading (no id available)", () => {
    useConsultationData.mockReturnValue({ data: null, loading: true, error: false })
    renderDrawer()
    expect(screen.queryByLabelText("Ouvrir en page plein écran")).toBeNull()
  })

  it("hides the toggle on a fetch error (content shows the error, not the record)", () => {
    // Même si `data` restait renseigné, une erreur masque la bascule (C2 revue #618).
    useConsultationData.mockReturnValue({ data: { id: 42, flags: {} }, loading: false, error: true })
    renderDrawer()
    expect(screen.queryByLabelText("Ouvrir en page plein écran")).toBeNull()
  })
})
