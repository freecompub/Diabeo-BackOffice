/**
 * @vitest-environment jsdom
 */

/**
 * Integration test for the patient dashboard page (US-3356/3361/3362/3363).
 *
 * Clinical safety context: this is the page a patient lands on after login.
 * It composes three independent sections (24h CGM, 4 KPI metrics, AGP 7d
 * summary). A schema mismatch between the API response and the page would
 * silently render "—" for every metric, hide the chart, or crash a section.
 *
 * The test renders the page with `fetch` mocked against the REAL API shapes
 * — that's what catches C2/C3/C4 from review round 2 (response shapes had
 * drifted between page assumptions and analytics.service / glycemia.service
 * return values).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("next-intl", async () =>
  (await import("../helpers/nextIntlMock")).makeNextIntlMock())
import { render, screen, waitFor } from "@testing-library/react"
import PatientDashboardPage from "@/app/(patient)/patient/dashboard/page"

// Recharts uses ResizeObserver which is absent from jsdom.
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Build a fetch mock that returns the REAL API shapes for the 3 endpoints. */
function mockApi(opts?: {
  cgmStatus?: number
  cgmBody?: unknown
  cgmRecentOutOfRange?: "low" | "high" | "none"
  profileStatus?: number
  profileBody?: unknown
  agpStatus?: number
  agpBody?: unknown
}) {
  const cgmEntries = opts?.cgmBody ?? [
    { timestamp: new Date().toISOString(), valueGl: 1.20 },
    { timestamp: new Date().toISOString(), valueGl: 1.45 },
  ]
  const profile = opts?.profileBody ?? {
    metrics: {
      averageGlucoseGl: 1.35,
      averageGlucoseMgdl: 135,
      gmi: 6.4,
      coefficientOfVariation: 28.5,
      quality: "good",
    },
    tir: { severeHypo: 0, hypo: 2, inRange: 78, elevated: 15, hyper: 5 },
  }
  const agp = opts?.agpBody ?? Array.from({ length: 20 }, (_, i) => ({
    timeMinutes: i * 15,
    p10: 0.7, p25: 0.9, p50: 1.1, p75: 1.4, p90: 1.8, count: 30,
  }))
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith("/api/cgm")) {
      const headers: Record<string, string> = { "content-type": "application/json" }
      if (opts?.cgmRecentOutOfRange) headers["X-CGM-Recent-Out-Of-Range"] = opts.cgmRecentOutOfRange
      return new Response(JSON.stringify(cgmEntries), { status: opts?.cgmStatus ?? 200, headers })
    }
    if (url.startsWith("/api/analytics/glycemic-profile")) {
      return new Response(JSON.stringify(profile),
        { status: opts?.profileStatus ?? 200, headers: { "content-type": "application/json" } })
    }
    if (url.startsWith("/api/analytics/agp")) {
      return new Response(JSON.stringify(agp),
        { status: opts?.agpStatus ?? 200, headers: { "content-type": "application/json" } })
    }
    return new Response("not found", { status: 404 })
  })
}

describe("Patient Dashboard (US-3356)", () => {
  it("renders the page title and all 3 section headings", async () => {
    mockApi()
    render(<PatientDashboardPage />)
    expect(screen.getByRole("heading", { level: 1, name: /Mon tableau de bord/i })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: /Glycémie sur 24 h/i })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: /Profil ambulatoire/i })).toBeTruthy()
  })

  it("C3 — KPIs use correct shape (inRange, averageGlucoseMgdl, CV, GMI)", async () => {
    mockApi()
    render(<PatientDashboardPage />)
    // inRange=78 → "Temps dans la cible" should display 78
    await waitFor(() => {
      expect(screen.getByText("78")).toBeTruthy() // TIR inRange
    })
    expect(screen.getByText("135")).toBeTruthy() // averageGlucoseMgdl
    expect(screen.getByText("28.5")).toBeTruthy() // CV
    expect(screen.getByText("6.4")).toBeTruthy() // GMI
  })

  it("H1 — sections fail independently: AGP 503 doesn't hide CGM/KPI", async () => {
    mockApi({ agpStatus: 503 })
    render(<PatientDashboardPage />)
    // KPI still rendered with successful data
    await waitFor(() => {
      expect(screen.getByText("135")).toBeTruthy()
    })
    // AGP section shows error alert
    expect(screen.getByText(/Service temporairement indisponible/i)).toBeTruthy()
  })

  it("H2 — GDPR 403 surfaces a specific actionable message", async () => {
    mockApi({
      cgmStatus: 403,
      cgmBody: { error: "gdprConsentRequired" },
    })
    render(<PatientDashboardPage />)
    await waitFor(() => {
      expect(screen.getByText(/Acceptez la politique de confidentialité/i)).toBeTruthy()
    })
  })

  it("surfaces the severe-hypo caveat (assertive role=alert) when /api/cgm flags a recent LOW", async () => {
    mockApi({ cgmRecentOutOfRange: "low" })
    render(<PatientDashboardPage />)
    await waitFor(() => {
      const banner = screen.getByText(/hors plage affichable/i)
      expect(banner).toBeTruthy()
      // LOW = urgence actionnable → role="alert" (assertif).
      expect(banner.getAttribute("role")).toBe("alert")
    })
  })

  it("uses a polite role=status for a recent HIGH out-of-range reading", async () => {
    mockApi({ cgmRecentOutOfRange: "high" })
    render(<PatientDashboardPage />)
    await waitFor(() => {
      const banner = screen.getByText(/hors plage affichable/i)
      // HIGH = non seconde-critique → role="status" (poli).
      expect(banner.getAttribute("role")).toBe("status")
    })
  })

  it("does NOT show the caveat when the CGM freshness header is 'none'", async () => {
    mockApi({ cgmRecentOutOfRange: "none" })
    render(<PatientDashboardPage />)
    await waitFor(() => {
      expect(screen.getByText("135")).toBeTruthy() // page loaded
    })
    expect(screen.queryByText(/hors plage affichable/i)).toBeNull()
  })

  it("C1 — does NOT wrap content in <main> (NavigationShell provides it)", () => {
    mockApi()
    const { container } = render(<PatientDashboardPage />)
    expect(container.querySelector("main")).toBeNull()
  })

  it("C5 — errors use role=alert (assertive announcement)", async () => {
    mockApi({ cgmStatus: 503 })
    render(<PatientDashboardPage />)
    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert")
      expect(alerts.length).toBeGreaterThan(0)
    })
  })
})
