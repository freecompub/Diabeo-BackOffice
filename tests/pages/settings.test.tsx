/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the Settings / Profile page — P2 GDPR, masking.
 *
 * Clinical safety context:
 * - NIRPP and INS are sensitive administrative identifiers that must be
 *   masked by default to prevent shoulder-surfing in clinical environments
 * - GDPR consent toggle controls data processing permissions
 * - Administrative fields are read-only to prevent accidental modification
 *
 * @see src/app/settings/SettingsClient.tsx
 * @see CLAUDE.md — RGPD compliance requirements
 *
 * Note: the `page.tsx` Server Component wrapper (#475 §7) is not unit-tested
 * here — it relies on `next/headers` (`await headers()`), which does not run in
 * jsdom. Its only logic (read `x-user-role`, fail-closed redirect) is guarded by
 * the JWT middleware that injects the header; covered by E2E if needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/settings"),
  redirect: vi.fn(),
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// ---------------------------------------------------------------------------
// Import page AFTER mocks
// ---------------------------------------------------------------------------

import { SettingsClient } from "@/app/settings/SettingsClient"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_PROFILE = {
  firstname: "Jean",
  lastname: "Dupont",
  sex: "MALE",
  birthday: "1985-06-15",
  phone: "+33612345678",
  address1: "12 rue de la Paix",
  city: "Paris",
  nirpp: "1850675056789012",
  ins: "2850675056789999",
  oid: "1.2.250.1.71.4.5",
  patient: {
    pathology: "DT1",
    yearDiag: 2010,
  },
  medicalData: {
    heightCm: 175,
  },
}

const MOCK_UNITS = { unitGlycemia: 5, unitWeight: 6, unitSize: 8 }

const MOCK_DAY_MOMENTS = [
  { type: "MORNING", startTime: "06:00", endTime: "12:00" },
  { type: "NOON", startTime: "12:00", endTime: "14:00" },
  { type: "EVENING", startTime: "18:00", endTime: "22:00" },
  { type: "NIGHT", startTime: "22:00", endTime: "06:00" },
]

const MOCK_NOTIF_PREFS = {
  glycemiaReminders: true,
  insulinReminders: false,
  medicalAppointments: true,
  autoExport: false,
}

const MOCK_PRIVACY = {
  shareWithResearchers: false,
  shareWithProviders: true,
  analyticsEnabled: true,
  gdprConsent: true,
}

function setupFetchMocks() {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === "string") {
      if (url.includes("/api/account/units")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_UNITS,
        })
      }
      if (url.includes("/api/account/day-moments")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_DAY_MOMENTS,
        })
      }
      if (url.includes("/api/account/notifications")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_NOTIF_PREFS,
        })
      }
      if (url.includes("/api/account/privacy")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_PRIVACY,
        })
      }
      if (url.includes("/api/account/export")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob(["test"]),
        })
      }
      if (url.includes("/api/account")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_PROFILE,
        })
      }
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
}

async function renderAndWaitForLoad(role: "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER" = "VIEWER") {
  setupFetchMocks()
  await act(async () => {
    // role=VIEWER (patient) shows all sections — preserves existing assertions.
    render(<SettingsClient role={role} />)
  })
  // Wait for loading to complete — look for the profile title text
  await waitFor(() => {
    expect(screen.getByText("profile.myProfile")).toBeTruthy()
  })
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Section headings ────────────────────────────────────────────────────

  it("renders all 9 section headings for a VIEWER (patient)", async () => {
    await renderAndWaitForLoad()

    // The page renders both mobile (accordion) and desktop (nav+panel) layouts,
    // so section titles may appear multiple times. We check getAllByText.
    const sectionIds = [
      "personalInfo",
      "medicalData",
      "administrative",
      "contact",
      "units",
      "dayMoments",
      "notifications",
      "privacy",
      "sessions",
    ]

    for (const id of sectionIds) {
      const elements = screen.getAllByText(`profile.${id}.title`)
      expect(elements.length).toBeGreaterThanOrEqual(1)
    }
  })

  // ── #475 §7 — role gating ───────────────────────────────────────────────

  it("hides patient-only sections for a DOCTOR (medicalData/administrative/dayMoments/privacy)", async () => {
    await renderAndWaitForLoad("DOCTOR")

    for (const hidden of ["medicalData", "administrative", "dayMoments", "privacy"]) {
      expect(screen.queryByText(`profile.${hidden}.title`)).toBeNull()
    }
    // Pro-relevant sections remain visible.
    for (const shown of ["personalInfo", "contact", "units", "notifications", "sessions"]) {
      expect(screen.getAllByText(`profile.${shown}.title`).length).toBeGreaterThanOrEqual(1)
    }
  })

  it("shows patient-only sections for a VIEWER (patient)", async () => {
    await renderAndWaitForLoad("VIEWER")
    for (const shown of ["medicalData", "administrative", "dayMoments", "privacy"]) {
      expect(screen.getAllByText(`profile.${shown}.title`).length).toBeGreaterThanOrEqual(1)
    }
  })

  // #475 L1 — patient notification toggles (glycemia/insulin) gated.
  it("hides glycemia/insulin reminder toggles for a DOCTOR, keeps appointments/autoExport", async () => {
    await renderAndWaitForLoad("DOCTOR")
    expect(screen.queryByText("profile.notifications.glycemiaReminders")).toBeNull()
    expect(screen.queryByText("profile.notifications.insulinReminders")).toBeNull()
    expect(screen.getAllByText("profile.notifications.medicalAppointments").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("profile.notifications.autoExport").length).toBeGreaterThanOrEqual(1)
  })

  it("shows glycemia/insulin reminder toggles for a VIEWER (patient)", async () => {
    await renderAndWaitForLoad("VIEWER")
    expect(screen.getAllByText("profile.notifications.glycemiaReminders").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("profile.notifications.insulinReminders").length).toBeGreaterThanOrEqual(1)
  })

  // ── NIRPP masking ───────────────────────────────────────────────────────

  it("NIRPP masked by default (shows asterisks)", async () => {
    await renderAndWaitForLoad()

    // Navigate to administrative section first
    const navButtons = screen.getAllByText("profile.administrative.title")
    fireEvent.click(navButtons[navButtons.length - 1])

    await waitFor(() => {
      // The NIRPP should be masked — showing "* ** ** ** *** *** 12"
      // (last 2 digits of "1850675056789012" are "12")
      // Both mobile (accordion) and desktop layouts may render the content,
      // so use getAllByText.
      const maskedTexts = screen.getAllByText(/\* \*\* \*\* \*\* \*\*\* \*\*\* 12/)
      expect(maskedTexts.length).toBeGreaterThanOrEqual(1)
    })

    // The full NIRPP should NOT be visible
    expect(screen.queryByText("1850675056789012")).toBeNull()
  })

  it("NIRPP reveal toggle shows full value", async () => {
    await renderAndWaitForLoad()

    // Navigate to administrative section
    const navButtons = screen.getAllByText("profile.administrative.title")
    fireEvent.click(navButtons[navButtons.length - 1])

    await waitFor(() => {
      const masked = screen.getAllByText(/\* \*\* \*\* \*\* \*\*\* \*\*\* 12/)
      expect(masked.length).toBeGreaterThanOrEqual(1)
    })

    // Find the NIRPP reveal button
    // aria-label: `${t("administrative.reveal")} NIRPP` = "profile.administrative.reveal NIRPP"
    const revealButtons = screen.getAllByRole("button", {
      name: /profile\.administrative\.reveal NIRPP/,
    })
    expect(revealButtons.length).toBeGreaterThanOrEqual(1)

    fireEvent.click(revealButtons[0])

    // Now the full NIRPP value should be visible
    await waitFor(() => {
      const revealed = screen.getAllByText("1850675056789012")
      expect(revealed.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── INS masking ─────────────────────────────────────────────────────────

  it("INS masked by default", async () => {
    await renderAndWaitForLoad()

    // Navigate to administrative section
    const navButtons = screen.getAllByText("profile.administrative.title")
    fireEvent.click(navButtons[navButtons.length - 1])

    await waitFor(() => {
      // INS "2850675056789999" — last 2 = "99"
      const maskedIns = screen.getAllByText(/\* \*\* \*\* \*\* \*\*\* \*\*\* 99/)
      expect(maskedIns.length).toBeGreaterThanOrEqual(1)
    })

    // Full INS should NOT be visible
    expect(screen.queryByText("2850675056789999")).toBeNull()
  })

  // ── Notifications toggles ──────────────────────────────────────────────

  it("notifications section has toggles", async () => {
    await renderAndWaitForLoad()

    // Navigate to notifications section via the desktop nav button.
    // The nav renders section titles — find the one for notifications.
    // Multiple elements may match (mobile accordion + desktop nav), so use getAll.
    const navButtons = screen.getAllByText("profile.notifications.title")
    // Click the desktop nav button (any of them will set active section)
    fireEvent.click(navButtons[navButtons.length - 1])

    await waitFor(() => {
      // Check that the notification toggle labels are rendered (may appear in
      // both mobile accordion and desktop panel)
      const labels = screen.getAllByText("profile.notifications.glycemiaReminders")
      expect(labels.length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.getAllByText("profile.notifications.insulinReminders").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("profile.notifications.medicalAppointments").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("profile.notifications.autoExport").length).toBeGreaterThanOrEqual(1)

    // Check that toggle switches exist (role="switch")
    const switches = screen.getAllByRole("switch")
    expect(switches.length).toBeGreaterThanOrEqual(4)
  })

  // ── Privacy / GDPR ─────────────────────────────────────────────────────

  it("privacy section has GDPR consent toggle", async () => {
    await renderAndWaitForLoad()

    // Navigate to privacy section
    const navButtons = screen.getAllByText("profile.privacy.title")
    fireEvent.click(navButtons[navButtons.length - 1])

    await waitFor(() => {
      expect(screen.getAllByText("profile.privacy.gdprConsent").length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getAllByText("profile.privacy.shareWithResearchers").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("profile.privacy.shareWithProviders").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("profile.privacy.analyticsEnabled").length).toBeGreaterThanOrEqual(1)
  })

  // ── Save triggers fetch ─────────────────────────────────────────────────

  it("save triggers fetch to correct endpoint", async () => {
    await renderAndWaitForLoad()

    // Find all save buttons — each section has its own
    const saveButtons = screen.getAllByText("common.save")
    expect(saveButtons.length).toBeGreaterThanOrEqual(1)

    // Reset fetch mock to track new calls
    mockFetch.mockClear()
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    // Click the first save button (personal info section)
    const firstSaveButton = saveButtons[0]
    fireEvent.click(firstSaveButton)

    await waitFor(() => {
      // Should have called fetch with PUT to /api/account
      const putCalls = mockFetch.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes("/api/account") &&
          (c[1] as RequestInit)?.method === "PUT"
      )
      expect(putCalls.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Administrative read-only ────────────────────────────────────────────

  it("administrative section fields are read-only", async () => {
    await renderAndWaitForLoad()

    // Navigate to the administrative section
    const navButtons = screen.getAllByText("profile.administrative.title")
    fireEvent.click(navButtons[navButtons.length - 1])

    await waitFor(() => {
      // The administrative section should show the read-only notice
      const notices = screen.getAllByText("profile.administrative.readonlyNotice")
      expect(notices.length).toBeGreaterThanOrEqual(1)
    })

    // The OID field should be displayed as read-only (via DiabeoReadonlyField)
    const oidElements = screen.getAllByText("1.2.250.1.71.4.5")
    expect(oidElements.length).toBeGreaterThanOrEqual(1)

    // The administrative section uses DiabeoReadonlyField, not input fields.
    // Find the section panel (desktop layout) and verify no editable inputs.
    const sectionPanel = document.getElementById("section-administrative")
    if (sectionPanel) {
      const inputs = sectionPanel.querySelectorAll("input[type='text'], input[type='number']")
      expect(inputs.length).toBe(0)
    }
  })
})
