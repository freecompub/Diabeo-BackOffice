/**
 * @vitest-environment jsdom
 */

/**
 * Tests — PatientDetailClient (câblage données patient, Phases 1-4).
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
  GlycemiaValue: ({ value, thresholds }: { value: number; thresholds?: { low?: number; high?: number } }) => (
    <span data-testid="glyc" data-low={thresholds?.low} data-high={thresholds?.high}>{value}</span>
  ),
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
vi.mock("@/components/diabeo/CgmChart", () => ({
  CgmChart: ({ data }: { data: unknown[] }) => <div data-testid="cgm-chart">{data.length} pts</div>,
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
  glycemia: {
    points: [
      { time: "08:00", glucose: 120 },
      { time: "08:05", glucose: 130 },
    ],
    lastReadingMgdl: 130,
    lastReadingAt: "08:05",
    lastReadingAgeMin: 3,
    stale: false,
  },
  treatment: {
    hasSettings: true,
    deliveryMethod: "pump",
    bolusInsulin: { name: "Humalog", genericName: "insulin lispro", dosage: "6-8U avant repas" },
    pump: { label: "Medtronic 780G", syncStale: false },
    isfSlots: [{ range: "00h–06h", value: 0.3 }],
    isfCoverage: { hasGap: false, hasOverlap: false },
    icrSlots: [{ range: "00h–06h", value: 10 }],
    icrCoverage: { hasGap: false, hasOverlap: false },
    basalSlots: [{ range: "00:00–06:00", rate: 0.8 }],
    basalCoverage: { hasGap: false, hasOverlap: false },
    treatments: [{ id: 1, name: "Metformine", posology: "850 mg x2/j" }],
  },
  documents: [
    { id: 7, title: "Compte rendu HDJ", category: "labResults", dateIso: "2026-06-01T09:00:00.000Z", size: { value: 1.2, unitKey: "sizeMb" } },
  ],
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

  it("renders the CGM chart + last reading (Phase 2) — all tabs now wired (no « coming soon »)", () => {
    render(<PatientDetailClient data={baseData} />)
    expect(screen.getByTestId("cgm-chart").textContent).toBe("2 pts")
    expect(screen.getByText("Dernière glycémie")).toBeTruthy()
    // Tous les onglets sont câblés → plus aucun état « bientôt disponible »
    expect(screen.queryByText(/Bientôt disponible/)).toBeNull()
  })

  it("renders the Documents tab (Phase 4) — title, category, size, download link", () => {
    render(<PatientDetailClient data={baseData} />)
    expect(screen.getByText("Compte rendu HDJ")).toBeTruthy()
    const dl = screen.getByText("Télécharger").closest("a")
    // doit porter le patientId pour la résolution de scope côté route (pro)
    expect(dl?.getAttribute("href")).toBe("/api/documents/7/download?patientId=42")
  })

  it("shows the empty Documents state when there are none", () => {
    render(<PatientDetailClient data={{ ...baseData, documents: [] }} />)
    expect(screen.getByText(/Aucun document/)).toBeTruthy()
  })

  it("renders the Traitements tab (Phase 3) — delivery, ISF/ICR/basal slots, treatments", () => {
    render(<PatientDetailClient data={baseData} />)
    expect(screen.getByText("Pompe à insuline")).toBeTruthy()
    expect(screen.getByText("0.3 g/L/U")).toBeTruthy() // créneau ISF
    expect(screen.getByText("10 g/U")).toBeTruthy() // créneau ICR
    expect(screen.getByText("0.8 U/h")).toBeTruthy() // créneau basal
    expect(screen.getByText("Humalog", { exact: false })).toBeTruthy() // insuline bolus
    expect(screen.getByText("Medtronic 780G")).toBeTruthy() // modèle pompe
    expect(screen.getByText("Metformine")).toBeTruthy()
  })

  it("hides the pump row for a manual (pen) delivery method", () => {
    render(
      <PatientDetailClient
        data={{
          ...baseData,
          treatment: { ...baseData.treatment, deliveryMethod: "manual" },
        }}
      />,
    )
    expect(screen.queryByText("Medtronic 780G")).toBeNull()
    expect(screen.queryByText("Modèle de pompe")).toBeNull()
  })

  it("shows « aucune pompe appairée » when delivery is pump but no device is paired", () => {
    render(
      <PatientDetailClient
        data={{ ...baseData, treatment: { ...baseData.treatment, pump: null } }}
      />,
    )
    expect(screen.getByText("Aucune pompe appairée")).toBeTruthy()
  })

  it("flags a stale pump sync", () => {
    render(
      <PatientDetailClient
        data={{
          ...baseData,
          treatment: { ...baseData.treatment, pump: { label: "Tandem t:slim X2", syncStale: true } },
        }}
      />,
    )
    expect(screen.getByText(/synchronisation ancienne/)).toBeTruthy()
    // Couverture saine → aucune note de garde-fou.
    expect(screen.queryByText(/non contigus/)).toBeNull()
    expect(screen.queryByText(/se chevauchent/)).toBeNull()
  })

  it("surfaces a fallback-tolerant gap note for ISF/ICR slots (not a basal one)", () => {
    render(
      <PatientDetailClient
        data={{
          ...baseData,
          treatment: { ...baseData.treatment, isfCoverage: { hasGap: true, hasOverlap: false } },
        }}
      />,
    )
    // Copie ratio (ISF) : « non contigus », pas la copie basale.
    expect(screen.getByText(/Créneaux non contigus sur 24 h/)).toBeTruthy()
    expect(screen.queryByText(/Couverture basale incomplète/)).toBeNull()
  })

  it("surfaces the stronger basal-coverage note when pump basal slots leave a gap", () => {
    render(
      <PatientDetailClient
        data={{
          ...baseData,
          treatment: { ...baseData.treatment, basalCoverage: { hasGap: true, hasOverlap: false } },
        }}
      />,
    )
    expect(screen.getByText(/Couverture basale incomplète sur 24 h/)).toBeTruthy()
  })

  it("surfaces the overlap note independently of gaps", () => {
    render(
      <PatientDetailClient
        data={{
          ...baseData,
          treatment: { ...baseData.treatment, icrCoverage: { hasGap: false, hasOverlap: true } },
        }}
      />,
    )
    expect(screen.getByText(/se chevauchent/)).toBeTruthy()
  })

  it("shows the no-insulin-settings state when none are recorded", () => {
    render(
      <PatientDetailClient
        data={{ ...baseData, treatment: { ...baseData.treatment, hasSettings: false, isfSlots: [], icrSlots: [], basalSlots: [] } }}
      />,
    )
    expect(screen.getByText("Aucun réglage d'insulinothérapie enregistré.")).toBeTruthy()
  })

  it("shows an empty Glycémie state when there is no CGM series", () => {
    render(<PatientDetailClient data={{ ...baseData, glycemia: { points: [], lastReadingMgdl: null, lastReadingAt: null, lastReadingAgeMin: null, stale: false } }} />)
    expect(screen.queryByTestId("cgm-chart")).toBeNull()
  })

  it("color-codes the last reading with the patient's target thresholds (not defaults)", () => {
    render(<PatientDetailClient data={baseData} />)
    // Le relevé « dernière glycémie » passe les cibles patient (vs la moyenne
    // d'aperçu qui n'en passe pas) → au moins un GlycemiaValue porte 70/180.
    const withThresholds = screen.getAllByTestId("glyc").find((n) => n.getAttribute("data-low") === "70")
    expect(withThresholds).toBeTruthy()
    expect(withThresholds!.getAttribute("data-high")).toBe("180")
  })

  it("shows a staleness note when the last reading is old", () => {
    render(
      <PatientDetailClient
        data={{ ...baseData, glycemia: { ...baseData.glycemia, lastReadingAgeMin: 540, stale: true } }}
      />,
    )
    expect(screen.getByText(/Relevé ancien/)).toBeTruthy()
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
