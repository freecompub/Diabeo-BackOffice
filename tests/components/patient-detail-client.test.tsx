/**
 * @vitest-environment jsdom
 */

/**
 * Tests — PatientDetailClient (câblage données patient, Phase 1).
 *
 * Vérifie le rendu/branchement client (valeurs serveur affichées telles
 * quelles, état « pas de CGM », onglets non câblés en « bientôt disponible ») ;
 * la garde d'accès + l'audit sont côté Server Component / services (testés
 * ailleurs).
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())

// Tabs base-ui → rend TOUT le contenu (pas d'interaction d'onglet à piloter).
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
// Composants présentation → stubs légers exposant label/valeur.
vi.mock("@/components/diabeo", () => ({
  StatCard: ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
    <div data-testid="stat">{label}: {value}{unit ? ` ${unit}` : ""}</div>
  ),
  TirDonut: () => <div data-testid="tir-donut" />,
  ClinicalBadge: ({ value }: { value: string }) => <span data-testid="pathology">{value}</span>,
  GlycemiaValue: ({ value }: { value: number }) => <span data-testid="glyc">{value}</span>,
}))
vi.mock("@/components/diabeo/DashboardHeader", () => ({
  DashboardHeader: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <header><h1>{title}</h1><p>{subtitle}</p></header>
  ),
}))
vi.mock("@/components/diabeo/Acronym", () => ({
  Acronym: ({ code }: { code: string }) => <abbr>{code}</abbr>,
}))
vi.mock("@/components/diabeo/DiabeoEmptyState", () => ({
  DiabeoEmptyState: ({ title, message }: { title: string; message: string }) => (
    <div data-testid="empty">{title} — {message}</div>
  ),
}))

import { PatientDetailClient, type PatientDetailData } from "@/app/(dashboard)/patients/[id]/PatientDetailClient"

const baseData: PatientDetailData = {
  id: 42,
  name: "Jean Dupont",
  age: 34,
  sex: "F",
  pathology: "DT1",
  diagYear: 2015,
  referent: "Dr House",
  objectives: { targetLowMgdl: 70, targetHighMgdl: 180, tirTargetPct: 70, hypoMaxPct: 4, cvMaxPct: 36 },
  stats: {
    avgGlucoseMgdl: 158,
    gmi: 7.1,
    cv: 34.2,
    tir: { veryLow: 1, low: 3, inRange: 75, high: 17, veryHigh: 4 },
    readingCount: 1200,
    captureRate: 92,
    insufficientCapture: false,
  },
}

describe("PatientDetailClient (Phase 1)", () => {
  it("renders the patient name + server-computed KPIs", () => {
    render(<PatientDetailClient data={baseData} />)
    expect(screen.getByText("Jean Dupont")).toBeTruthy()
    const stats = screen.getAllByTestId("stat").map((n) => n.textContent)
    expect(stats.some((s) => s?.includes("158"))).toBe(true) // moyenne mg/dL
    expect(stats.some((s) => s?.includes("75%"))).toBe(true) // TIR inRange
    expect(stats.some((s) => s?.includes("7.1%"))).toBe(true) // GMI
    expect(stats.some((s) => s?.includes("34.2%"))).toBe(true) // CV
    expect(screen.getByTestId("tir-donut")).toBeTruthy()
    expect(screen.getByTestId("pathology").textContent).toBe("DT1")
  })

  it("renders objective badges from server data (range + consensus targets)", () => {
    render(<PatientDetailClient data={baseData} />)
    expect(screen.getByText("Cible : 70–180 mg/dL")).toBeTruthy()
    expect(screen.getByText("Cible (TIR) : 70%")).toBeTruthy()
    expect(screen.getByText("Hypo max : 4%")).toBeTruthy()
  })

  it("shows the no-CGM state (no KPIs, no donut) when stats are null", () => {
    render(<PatientDetailClient data={{ ...baseData, stats: null }} />)
    expect(screen.queryByTestId("stat")).toBeNull()
    expect(screen.queryByTestId("tir-donut")).toBeNull()
    expect(screen.getAllByText("Pas de données de glycémie continue (CGM) sur la période.").length).toBeGreaterThan(0)
  })

  it("renders « coming soon » for the not-yet-wired tabs", () => {
    render(<PatientDetailClient data={baseData} />)
    // Glycémie + Traitements + Documents → 3 états vides
    expect(screen.getAllByTestId("empty")).toHaveLength(3)
    expect(screen.getAllByText(/Bientôt disponible/).length).toBe(3)
  })

  it("renders the sharing-disabled state (no PHI) when consent is withdrawn", () => {
    render(<PatientDetailClient data={null} sharingDisabled />)
    expect(screen.getByText(/Partage désactivé/)).toBeTruthy()
    expect(screen.queryByTestId("stat")).toBeNull()
    expect(screen.queryByText("Jean Dupont")).toBeNull()
  })

  it("shows the low-CGM-capture caveat when capture is insufficient", () => {
    render(
      <PatientDetailClient
        data={{ ...baseData, stats: { ...baseData.stats!, captureRate: 35, insufficientCapture: true } }}
      />,
    )
    expect(screen.getByText(/\(CGM\) insuffisante \(35 %\)/)).toBeTruthy()
  })

  it("degrades gracefully on missing profile fields (fallbacks)", () => {
    render(
      <PatientDetailClient
        data={{ ...baseData, name: "", pathology: null, diagYear: null, age: null, referent: null, sex: null }}
      />,
    )
    expect(screen.getByText("Patient")).toBeTruthy() // patientFallback
    expect(screen.queryByTestId("pathology")).toBeNull() // pas de badge si pathologie absente
  })
})
