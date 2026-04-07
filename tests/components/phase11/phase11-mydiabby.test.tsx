/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the MyDiabby Import Page — US-WEB-210
 *
 * Clinical safety context: this page allows doctors to connect a MyDiabby account
 * and synchronise patient data. Import only happens on explicit user action (sync
 * button) — there is no automatic background sync. All credentials are transmitted
 * over HTTPS and never stored in component state beyond the form fields.
 *
 * The page follows a state machine:
 *   loading → fetches accounts on mount
 *   noAccounts → shows connect form
 *   hasAccounts → shows account list with sync / disconnect actions
 *   stagingOnly → API returned 403 → shows unavailable empty state
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  usePathname: vi.fn(() => "/import"),
}))

// next-intl is auto-mocked via the resolve alias in vitest.config.ts

// ---------------------------------------------------------------------------
// Import the page under test AFTER mocks are in place
// ---------------------------------------------------------------------------

import MyDiabbyPage from "@/app/(dashboard)/import/page"

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_ACCOUNT = {
  id: "cred-001",
  email: "doctor@hospital.fr",
  lastSyncAt: null,
  createdAt: "2026-03-15T10:00:00.000Z",
}

const MOCK_ACCOUNT_SYNCED = {
  id: "cred-002",
  email: "nurse@clinic.fr",
  lastSyncAt: "2026-04-07T08:30:00.000Z",
  createdAt: "2026-03-10T09:00:00.000Z",
}

/**
 * Helper: creates a fetch mock response with the given body and status.
 */
function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    statusText: "OK",
    type: "basic" as ResponseType,
    url: "",
    clone: () => mockFetchResponse(body, status) as Response,
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MyDiabbyPage — US-WEB-210", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── 1. Renders page with correct data-testid ────────────────────────────

  it("renders the page with data-testid='mydiabby-page'", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [] })
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId("mydiabby-page")).toBeDefined()
    })
  })

  // ─── 2. Shows connect form when no accounts ──────────────────────────────

  it("shows connect form when the API returns an empty accounts list", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [] })
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId("connect-form")).toBeDefined()
    })

    // Email and password fields should be visible
    expect(screen.getByTestId("connect-email")).toBeDefined()
    expect(screen.getByTestId("connect-password")).toBeDefined()
    expect(screen.getByTestId("connect-button")).toBeDefined()
  })

  // ─── 3. Connect button is not disabled when fields are empty ─────────────
  //
  // The form uses noValidate and relies on server-side validation.
  // The button is only disabled during loading state.

  it("connect button is enabled by default (server-validated form)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [] })
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId("connect-form")).toBeDefined()
    })

    const button = screen.getByTestId("connect-button")
    // Button should not be disabled when fields are empty — form is server-validated
    expect(button.hasAttribute("disabled")).toBe(false)
  })

  // ─── 4. Connect form submits credentials ─────────────────────────────────

  it("submits credentials via POST /api/import/mydiabby/connect", async () => {
    // First call: GET accounts (empty)
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [] })
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId("connect-form")).toBeDefined()
    })

    const user = userEvent.setup()

    // Fill email and password fields
    const emailInput = screen.getByTestId("connect-email")
    const passwordInput = screen.getByTestId("connect-password")

    await user.type(emailInput, "test@hospital.fr")
    await user.type(passwordInput, "secret123")

    // Mock the POST connect response
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ success: true, result: {} })
    )
    // Mock the refetch after success
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [MOCK_ACCOUNT] })
    )

    const connectButton = screen.getByTestId("connect-button")
    await user.click(connectButton)

    // Verify the POST was called with correct arguments
    await waitFor(() => {
      const postCall = (mockFetch as Mock).mock.calls.find(
        (call: unknown[]) =>
          call[0] === "/api/import/mydiabby/connect" &&
          (call[1] as RequestInit)?.method === "POST"
      )
      expect(postCall).toBeDefined()

      const body = JSON.parse((postCall![1] as RequestInit).body as string)
      expect(body.email).toBe("test@hospital.fr")
      expect(body.password).toBe("secret123")
    })
  })

  // ─── 5. Shows error on connect failure ────────────────────────────────────

  it("shows an error message when connect returns 401", async () => {
    // GET accounts: empty
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [] })
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId("connect-form")).toBeDefined()
    })

    const user = userEvent.setup()

    await user.type(screen.getByTestId("connect-email"), "bad@email.fr")
    await user.type(screen.getByTestId("connect-password"), "wrong")

    // Mock connect failure (401)
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ error: "Unauthorized" }, 401)
    )

    await user.click(screen.getByTestId("connect-button"))

    // The error message should appear — uses the translation key "mydiabby.connectError"
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert")
      const errorAlert = alerts.find((el) =>
        el.textContent?.includes("mydiabby.connectError")
      )
      expect(errorAlert).toBeDefined()
    })
  })

  // ─── 6. Shows account list when accounts exist ────────────────────────────

  it("shows account list with masked email, status badge, sync and disconnect buttons", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [MOCK_ACCOUNT, MOCK_ACCOUNT_SYNCED] })
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    // Wait for accounts to render
    await waitFor(() => {
      // Masked email: "d***@hospital.fr" for doctor@hospital.fr
      const pageContent = screen.getByTestId("mydiabby-page").textContent
      expect(pageContent).toContain("d***@hospital.fr")
    })

    // Second account should also appear with masked email
    const pageContent = screen.getByTestId("mydiabby-page").textContent
    expect(pageContent).toContain("n***@clinic.fr")

    // Status badges should display "connected" translation key
    const connectedBadges = screen.getAllByText("mydiabby.connected")
    expect(connectedBadges.length).toBe(2)

    // Sync and disconnect buttons should be present for each account
    const syncButtons = screen.getAllByTestId("sync-button")
    expect(syncButtons.length).toBe(2)

    const disconnectButtons = screen.getAllByTestId("disconnect-button")
    expect(disconnectButtons.length).toBe(2)
  })

  // ─── 7. Sync button calls the sync API ────────────────────────────────────

  it("calls POST /api/import/mydiabby/sync with credentialId when sync button is clicked", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [MOCK_ACCOUNT] })
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId("sync-button")).toBeDefined()
    })

    // Mock sync response
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ success: true, result: { count: 42 } })
    )

    const user = userEvent.setup()
    await user.click(screen.getByTestId("sync-button"))

    await waitFor(() => {
      const syncCall = (mockFetch as Mock).mock.calls.find(
        (call: unknown[]) =>
          call[0] === "/api/import/mydiabby/sync" &&
          (call[1] as RequestInit)?.method === "POST"
      )
      expect(syncCall).toBeDefined()

      const body = JSON.parse((syncCall![1] as RequestInit).body as string)
      expect(body.credentialId).toBe("cred-001")
    })
  })

  // ─── 8. Disconnect button shows confirmation dialog ───────────────────────

  it("shows a confirmation dialog when disconnect button is clicked", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [MOCK_ACCOUNT] })
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId("disconnect-button")).toBeDefined()
    })

    const user = userEvent.setup()
    await user.click(screen.getByTestId("disconnect-button"))

    // The confirmation dialog should display the disconnect title and confirm text
    await waitFor(() => {
      const pageText = document.body.textContent
      expect(pageText).toContain("mydiabby.disconnectTitle")
      expect(pageText).toContain("mydiabby.disconnectConfirm")
    })
  })

  // ─── 9. Staging notice banner renders ─────────────────────────────────────

  it("shows the staging notice banner when accounts are loaded (noAccounts state)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [] })
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId("connect-form")).toBeDefined()
    })

    // The staging notice uses the translation key "mydiabby.stagingNotice"
    const pageText = screen.getByTestId("mydiabby-page").textContent
    expect(pageText).toContain("mydiabby.stagingNotice")
  })

  it("shows the staging notice banner when accounts exist (hasAccounts state)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ accounts: [MOCK_ACCOUNT] })
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId("sync-button")).toBeDefined()
    })

    const pageText = screen.getByTestId("mydiabby-page").textContent
    expect(pageText).toContain("mydiabby.stagingNotice")
  })

  // ─── 10. Staging-only guard (403) ─────────────────────────────────────────

  it("shows unavailable empty state when API returns 403 (staging-only guard)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({ error: "stagingOnly" }, 403)
    )

    await act(async () => {
      render(<MyDiabbyPage />)
    })

    await waitFor(() => {
      const pageText = screen.getByTestId("mydiabby-page").textContent
      expect(pageText).toContain("mydiabby.notAvailable")
    })
  })
})
