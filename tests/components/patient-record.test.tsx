/**
 * @vitest-environment jsdom
 */

/**
 * Tests — PatientRecord (présentational) + son adaptateur page PatientDetailClient
 * (câblage données patient, Phases 1-4).
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
// Barre de contexte (US-2603) stubée : le switcher tire useRouter/fetch, hors
// périmètre de ce test (couverte par ses propres tests + tests de route).
vi.mock("@/components/diabeo/patient/PatientContextBar", () => ({
  PatientContextBar: ({ name }: { name: string }) => <header><h1>{name}</h1></header>,
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
// Onglet AGP (US-2635) stubé : il fetche via cTok/?patientId (couvert par son
// propre test). Ici on vérifie seulement qu'il est monté avec les cibles.
vi.mock("@/components/diabeo/patient/PatientAgpTab", () => ({
  PatientAgpTab: ({ targetLowMgdl, targetHighMgdl }: { targetLowMgdl: number; targetHighMgdl: number }) => (
    <div data-testid="agp-tab" data-low={targetLowMgdl} data-high={targetHighMgdl}>AGP</div>
  ),
}))
// Onglet Tendances de repas (US-2637) stubé : il fetche via cTok/?patientId
// (couvert par son propre test + le test service).
vi.mock("@/components/diabeo/patient/PatientMealTrendsTab", () => ({
  PatientMealTrendsTab: () => <div data-testid="meal-trends-tab">Meal trends</div>,
}))
// Vue/nuage BGM (US-2638 slice B) stubés : ils fetchent (usePeriodAnalytics) /
// tirent recharts — couverts par leurs propres tests. Ici on vérifie le
// BRANCHEMENT fail-closed selon dataSource.
vi.mock("@/components/diabeo/patient/PatientBgmOverview", () => ({
  PatientBgmOverview: () => <div data-testid="bgm-overview">BGM overview</div>,
}))
vi.mock("@/components/diabeo/patient/PatientBgmScatter", () => ({
  PatientBgmScatter: ({ points }: { points: unknown[] }) => <div data-testid="bgm-scatter">{points.length} pts</div>,
}))

import { PatientDetailClient, type PatientDetailData } from "@/app/(dashboard)/patients/[id]/PatientDetailClient"
import { PatientRecord } from "@/components/diabeo/patient/PatientRecord"

const baseData: PatientDetailData = {
  id: 42,
  publicRef: "ref-42",
  flags: { recentHypos: false, hypoCount: 0, silentMonitoring: false, silentDays: null, openUrgency: false },
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
  dataSource: "cgm",
  bgm: null,
  glycemia: {
    points: [
      { time: "08:00", glucose: 120 },
      { time: "08:05", glucose: 130 },
    ],
    lastReadingMgdl: 130,
    lastReadingAt: "08:05",
    lastReadingAgeMin: 3,
    stale: false,
    recentOutOfRange: null,
    outOfDisplayRangeCount: 0,
  },
  treatment: {
    hasSettings: true,
    deliveryMethod: "pump",
    bolusInsulin: { name: "Humalog", genericName: "insulin lispro", dosage: "6-8U avant repas" },
    bolusInconsistent: false,
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

describe("PatientRecord — via adaptateur page PatientDetailClient (Phase 1)", () => {
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

  it("BGM patient: fail-closed presentation (no TIR/GMI/donut/AGP), BGM overview + scatter", () => {
    const bgmData = {
      ...baseData,
      dataSource: "bgm" as const,
      stats: null,
      bgm: {
        avgMgdl: 145,
        inRangePercent: 58,
        readingsPerDay: 3.2,
        targetRangeMgdl: { low: 70, high: 180 },
        hba1c: { value: 7.4, date: "2026-05-01T00:00:00.000Z", ageDays: 60, stale: false },
        points: [
          { timeMinutes: 480, mgdl: 120 },
          { timeMinutes: 720, mgdl: 200 },
        ],
      },
    }
    render(<PatientDetailClient data={bgmData} />)
    // Vue d'ensemble BGM montée à la place des KPI CGM ; aucun donut TIR-temps.
    expect(screen.getByTestId("bgm-overview")).toBeTruthy()
    expect(screen.queryByTestId("tir-donut")).toBeNull()
    // AGP fail-closed : message « non disponible en capillaire », pas d'onglet AGP.
    expect(screen.queryByTestId("agp-tab")).toBeNull()
    expect(screen.getByText(/profil ambulatoire glycémique \(AGP\)/)).toBeTruthy()
    // Onglet Glycémie : nuage de points capillaires (2 pts), pas de courbe CGM.
    expect(screen.getByTestId("bgm-scatter").textContent).toBe("2 pts")
    expect(screen.queryByTestId("cgm-chart")).toBeNull()
  })

  it("renders the CGM chart + last reading (Phase 2) — all tabs now wired (no « coming soon »)", () => {
    render(<PatientDetailClient data={baseData} />)
    expect(screen.getByTestId("cgm-chart").textContent).toBe("2 pts")
    expect(screen.getByText("Dernière glycémie")).toBeTruthy()
    // Tous les onglets sont câblés → plus aucun état « bientôt disponible »
    expect(screen.queryByText(/Bientôt disponible/)).toBeNull()
    // Aucun relevé hors plage → pas d'annotation.
    expect(screen.queryByText(/hors plage d'affichage/)).toBeNull()
  })

  it("annotates the chart when readings were excluded from the display range (counted in TIR)", () => {
    render(
      <PatientDetailClient
        data={{ ...baseData, glycemia: { ...baseData.glycemia, outOfDisplayRangeCount: 3 } }}
      />,
    )
    expect(screen.getByText(/hors plage d'affichage/)).toBeTruthy()
  })

  it("renders the Documents tab (Phase 4) — title, category, size, download link", () => {
    render(<PatientDetailClient data={baseData} />)
    expect(screen.getByText("Compte rendu HDJ")).toBeTruthy()
    const dl = screen.getByText("Télécharger").closest("a")
    // doit porter le patientId pour la résolution de scope côté route (pro)
    expect(dl?.getAttribute("href")).toBe("/api/documents/7/download?patientId=42")
  })

  // US-2632 — <PatientRecord> ne construit pas l'URL lui-même : il délègue au
  // contrat `documentHref` (le drawer fournira une variante `cTok`).
  it("delegates the document link to the documentHref contract (drawer-ready)", () => {
    render(
      <PatientRecord
        data={baseData}
        documentHref={(id) => `/cTok/documents/${id}`}
      />,
    )
    const dl = screen.getByText("Télécharger").closest("a")
    expect(dl?.getAttribute("href")).toBe("/cTok/documents/7")
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

  it("surfaces a bolus-inconsistency note when the FK is set but not displayable", () => {
    render(
      <PatientDetailClient
        data={{
          ...baseData,
          treatment: { ...baseData.treatment, bolusInsulin: null, bolusInconsistent: true },
        }}
      />,
    )
    expect(screen.getByText(/configurée mais incohérente/)).toBeTruthy()
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
    render(<PatientDetailClient data={{ ...baseData, glycemia: { points: [], lastReadingMgdl: null, lastReadingAt: null, lastReadingAgeMin: null, stale: false, recentOutOfRange: null, outOfDisplayRangeCount: 0 } }} />)
    expect(screen.queryByTestId("cgm-chart")).toBeNull()
  })

  it("surfaces the severe-hypo caveat when a more recent out-of-range reading was excluded", () => {
    render(
      <PatientDetailClient
        data={{ ...baseData, glycemia: { ...baseData.glycemia, recentOutOfRange: "low" } }}
      />,
    )
    expect(screen.getByText(/hors plage affichable/)).toBeTruthy()
    expect(screen.getByText(/hypoglycémie sévère/)).toBeTruthy()
    // LOW = urgence actionnable → annonce assertive (role="alert"), pas "status".
    expect(screen.getByRole("alert").textContent).toMatch(/hypoglycémie sévère/)
  })

  it("uses a polite role=status for the HIGH out-of-range caveat (non seconde-critique)", () => {
    render(
      <PatientDetailClient
        data={{ ...baseData, glycemia: { ...baseData.glycemia, recentOutOfRange: "high" } }}
      />,
    )
    // HIGH = important mais non urgent → role="status" (poli), jamais "alert".
    // (Plusieurs role=status coexistent — dont la live-region de période ; on
    // cible le caveat par son texte.)
    const caveat = screen.getByText(/hors plage affichable/)
    expect(caveat.getAttribute("role")).toBe("status")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shows the caveat even with no displayable CGM series (most dangerous case)", () => {
    render(
      <PatientDetailClient
        data={{
          ...baseData,
          glycemia: { points: [], lastReadingMgdl: null, lastReadingAt: null, lastReadingAgeMin: null, stale: false, recentOutOfRange: "low", outOfDisplayRangeCount: 0 },
        }}
      />,
    )
    expect(screen.getByText(/hors plage affichable/)).toBeTruthy()
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

describe("PatientRecord — variant drawer (US-2633)", () => {
  it("omits PatientContextBar (no id-bearing chrome) but keeps the tab content", () => {
    render(<PatientRecord data={baseData} variant="drawer" />)
    // En mode page, le nom vient de PatientContextBar (mocké) ; en drawer il
    // est absent (l'en-tête du drawer le porte, hors de ce composant).
    expect(screen.queryByText("Jean Dupont")).toBeNull()
    // Les KPI serveur restent rendus (contenu des onglets présent).
    expect(screen.getAllByTestId("stat").length).toBeGreaterThan(0)
  })

  it("renders the native AGP tab (US-2635) with pathology-aware target bounds", () => {
    render(<PatientRecord data={baseData} variant="drawer" />)
    // Onglet natif présent (plus de slot injecté).
    expect(screen.getByText("Profil glycémique (AGP)")).toBeTruthy()
    // Cibles pathology-aware transmises au chart (adulte 70–180 ici).
    const agp = screen.getByTestId("agp-tab")
    expect(agp.getAttribute("data-low")).toBe("70")
    expect(agp.getAttribute("data-high")).toBe("180")
  })

  it("lists documents WITHOUT a download link when no documentHref is given (cTok mode)", () => {
    render(<PatientRecord data={baseData} variant="drawer" />)
    expect(screen.getByText("Compte rendu HDJ")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("renders a download link only when documentHref is provided (page contract)", () => {
    render(<PatientRecord data={baseData} documentHref={(id) => `/dl/${id}`} />)
    expect(screen.getByRole("link").getAttribute("href")).toBe("/dl/7")
  })
})
