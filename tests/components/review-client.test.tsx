/**
 * @vitest-environment jsdom
 */

/**
 * Tests — ReviewClient (mode revue de consultation, US-2605).
 *
 * Vérifie le rendu/branchement client : valeurs serveur affichées telles
 * quelles, gouvernance des décisions (accept/reject DOCTOR-only via `canDecide`),
 * finalisation du compte rendu (POST), et état « partage désactivé ».
 * Les gardes d'accès + l'audit sont côté Server Component / service (testés ailleurs).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())

// Tabs base-ui → rend TOUT le contenu (toutes les étapes visibles d'un coup).
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/diabeo", () => ({
  StatCard: ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
    <div data-testid="stat">{label}: {value}{unit ? ` ${unit}` : ""}</div>
  ),
  TirDonut: () => <div data-testid="tir-donut" />,
  ClinicalBadge: ({ value }: { value: string }) => <span data-testid="pathology">{value}</span>,
  GlycemiaValue: ({ value }: { value: number }) => <span data-testid="glyc">{value}</span>,
}))
vi.mock("@/components/diabeo/DashboardHeader", () => ({
  DashboardHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header>,
}))
vi.mock("@/components/diabeo/patient/PatientContextBar", () => ({
  PatientContextBar: ({ name }: { name: string }) => <header><h2>{name}</h2></header>,
}))
vi.mock("@/components/diabeo/Acronym", () => ({
  Acronym: ({ code }: { code: string }) => <abbr>{code}</abbr>,
}))
vi.mock("@/components/diabeo/DiabeoEmptyState", () => ({
  DiabeoEmptyState: ({ title, message }: { title: string; message: string }) => (
    <div data-testid="empty">{title} — {message}</div>
  ),
}))
vi.mock("@/components/diabeo/CgmChart", () => ({
  CgmChart: ({ data }: { data: unknown[] }) => <div data-testid="cgm-chart">{data.length} pts</div>,
}))

import { ReviewClient, type ReviewData } from "@/app/(dashboard)/patients/[id]/review/ReviewClient"

const BASE: ReviewData = {
  encounterId: 12,
  draftReport: "brouillon existant",
  canDecide: true,
  anchor: { periodDays: 14, dataAsOf: "2026-06-16T10:00:00.000Z" },
  patient: {
    id: 42, name: "Jean Test", age: 50, sex: "M", pathology: "DT1",
    diagYear: 2010, referent: "Dr House",
    flags: { recentHypos: false, hypoCount: 0, silentMonitoring: false, silentDays: null, openUrgency: false },
  },
  objectives: { targetLowMgdl: 70, targetHighMgdl: 180, tirTargetPct: 70, hypoMaxPct: 4, cvMaxPct: 36 },
  stats: {
    avgGlucoseMgdl: 142, gmi: 6.8, cv: 32,
    tir: { veryLow: 1, low: 3, inRange: 75, high: 18, veryHigh: 3 },
    readingCount: 1000, captureRate: 95, insufficientCapture: false,
  },
  glycemia: {
    points: [{ time: "08:00", glucose: 120 }],
    lastReadingMgdl: 120, lastReadingAt: "08:00", lastReadingAgeMin: 5,
    stale: false, recentOutOfRange: null, outOfDisplayRangeCount: 0,
  },
  treatment: {
    hasSettings: true, deliveryMethod: "pump", bolusInsulin: { name: "Novorapid", genericName: "aspart", dosage: null },
    bolusInconsistent: false, pump: null,
    isfSlots: [{ range: "00:00–24:00", value: 0.5 }], isfCoverage: { hasGap: false, hasOverlap: false },
    icrSlots: [], icrCoverage: { hasGap: false, hasOverlap: false },
    basalSlots: [], basalCoverage: { hasGap: false, hasOverlap: false },
    treatments: [],
  },
  proposals: [
    {
      id: "p1", parameterType: "basalRate", currentValue: 1.0, proposedValue: 1.2,
      changePercent: 20, reason: "trend", confidence: "high",
      timeSlotStartHour: null, timeSlotEndHour: null, createdAt: "2026-06-15T00:00:00.000Z",
    },
  ],
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

describe("ReviewClient", () => {
  it("affiche les valeurs serveur du Résumé et le nom patient", () => {
    render(<ReviewClient data={BASE} />)
    expect(screen.getByText("Jean Test")).toBeTruthy()
    // Glycémie moyenne serveur affichée telle quelle.
    expect(screen.getAllByTestId("stat").some((n) => n.textContent?.includes("142"))).toBe(true)
  })

  it("médecin : accepter une proposition appelle la route et la retire de la liste", async () => {
    render(<ReviewClient data={BASE} />)
    const accept = screen.getByRole("button", { name: "Accepter" })
    fireEvent.click(accept)
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/adjustment-proposals/p1/accept",
        expect.objectContaining({ method: "PATCH" }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole("button", { name: "Accepter" })).toBeNull())
  })

  it("non-médecin : pas de bouton d'action, note lecture seule", () => {
    render(<ReviewClient data={{ ...BASE, canDecide: false }} />)
    expect(screen.queryByRole("button", { name: "Accepter" })).toBeNull()
    expect(screen.getByText(/Lecture seule/)).toBeTruthy()
  })

  it("finalise le compte rendu (POST) et affiche l'état immuable", async () => {
    render(<ReviewClient data={BASE} />)
    const finalize = screen.getByRole("button", { name: "Finaliser le compte rendu" })
    fireEvent.click(finalize)
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/encounters/12/finalize",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    await waitFor(() => expect(screen.getByText(/finalisé et immuable/)).toBeTruthy())
  })

  it("décision en échec : message d'erreur + proposition conservée", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })))
    render(<ReviewClient data={BASE} />)
    fireEvent.click(screen.getByRole("button", { name: "Accepter" }))
    await waitFor(() => expect(screen.getByText(/n'a pas pu être enregistrée/)).toBeTruthy())
    // Retrait optimiste seulement en cas de succès : la proposition reste listée.
    expect(screen.getByRole("button", { name: "Accepter" })).toBeTruthy()
  })

  it("n'autosave PAS au montage d'un brouillon repris (pas de PATCH fantôme, M1)", () => {
    vi.useFakeTimers()
    try {
      render(<ReviewClient data={BASE} />)
      vi.advanceTimersByTime(2000)
      expect(fetch).not.toHaveBeenCalledWith(
        "/api/encounters/12/draft",
        expect.anything(),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("autosave le brouillon après modification (PATCH draft)", () => {
    vi.useFakeTimers()
    try {
      render(<ReviewClient data={BASE} />)
      const ta = screen.getByLabelText(/Synthèse/)
      fireEvent.change(ta, { target: { value: "texte modifié" } })
      vi.advanceTimersByTime(1500)
      expect(fetch).toHaveBeenCalledWith(
        "/api/encounters/12/draft",
        expect.objectContaining({ method: "PATCH" }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("partage désactivé : aucune donnée patient, état vide", () => {
    render(<ReviewClient data={null} sharingDisabled />)
    expect(screen.getByTestId("empty")).toBeTruthy()
    expect(screen.queryByText("Jean Test")).toBeNull()
  })
})
