/**
 * @vitest-environment jsdom
 *
 * Tests pour `useMessagingContacts` (US-2076-UI iter 4).
 *
 * Couvre :
 *   - skip=true → no fetch + isLoading=false
 *   - happy path : array de patients backend → MessagingContact mapped
 *   - shape `{ items: [...] }` (defensive fallback)
 *   - patient sans userId → filtré (defense-in-depth)
 *   - 401 → redirect /login?expired=1
 *   - 403 → error forbidden
 *   - 500 → error unexpectedError
 *   - network → error networkError
 *   - displayName format "Patient #N"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useMessagingContacts } from "@/components/diabeo/messaging/useMessagingContacts"

const originalLocation = window.location

describe("useMessagingContacts", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockReset()
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: originalLocation.href },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    })
  })

  it("skip=true → no fetch + isLoading=false", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    const { result } = renderHook(() => useMessagingContacts({ skip: true }))
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.contacts).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it("happy path : { items: [...] } backend → MessagingContact mapped", async () => {
    // Fix H3 round 1 review PR #444 — endpoint /api/messaging/contacts
    // retourne maintenant `{ items: [{patientId, userId, displayName}] }`.
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { patientId: 1, userId: 100, displayName: "Patient #1" },
          { patientId: 2, userId: 200, displayName: "Patient #2" },
          { patientId: 3, userId: 300, displayName: "Patient #3" },
        ],
      }),
    } as Response)
    const { result } = renderHook(() => useMessagingContacts())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.contacts.length).toBe(3)
    expect(result.current.contacts[0]).toEqual({
      patientId: 1,
      userId: 100,
      displayName: "Patient #1",
    })
  })

  it("URL fetch /api/messaging/contacts (vs ancien /api/patients)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response)
    renderHook(() => useMessagingContacts())
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/messaging/contacts",
        expect.objectContaining({ method: "GET" }),
      )
    })
  })

  it("fallback displayName si backend omit (defensive)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ patientId: 5, userId: 500 }], // displayName absent
      }),
    } as Response)
    const { result } = renderHook(() => useMessagingContacts())
    await waitFor(() => expect(result.current.contacts.length).toBe(1))
    expect(result.current.contacts[0]?.displayName).toBe("Patient #5")
  })

  it("patient sans userId → filtré (defensive)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { patientId: 1, userId: 100, displayName: "Patient #1" },
          { patientId: 2 }, // missing userId
          { patientId: 3, userId: "not-a-number" },
        ],
      }),
    } as Response)
    const { result } = renderHook(() => useMessagingContacts())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.contacts.length).toBe(1)
    expect(result.current.contacts[0]?.userId).toBe(100)
  })

  it("401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
    } as Response)
    renderHook(() => useMessagingContacts())
    await waitFor(() => expect(window.location.href).toBe("/login?expired=1"))
  })

  it("403 forbidden RBAC → error forbidden", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" }),
    } as Response)
    const { result } = renderHook(() => useMessagingContacts())
    await waitFor(() => expect(result.current.error).toBe("forbidden"))
    expect(result.current.contacts).toEqual([])
  })

  it("403 gdprConsentRequired → error gdprConsentRevoked", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "gdprConsentRequired" }),
    } as Response)
    const { result } = renderHook(() => useMessagingContacts())
    await waitFor(() => expect(result.current.error).toBe("gdprConsentRevoked"))
    expect(result.current.contacts).toEqual([])
  })

  it("500 → error unexpectedError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)
    const { result } = renderHook(() => useMessagingContacts())
    await waitFor(() => expect(result.current.error).toBe("unexpectedError"))
  })

  it("network error → networkError", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("net"))
    const { result } = renderHook(() => useMessagingContacts())
    await waitFor(() => expect(result.current.error).toBe("networkError"))
  })

  it("non-array response → empty contacts", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ unrelated: "shape" }),
    } as Response)
    const { result } = renderHook(() => useMessagingContacts())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.contacts).toEqual([])
  })

  it("Fix M3 round 1 PR #444 : reset contacts à [] quand skip flip false→true→false", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ patientId: 1, userId: 100, displayName: "Patient #1" }],
      }),
    } as Response)
    const { result, rerender } = renderHook(
      ({ skip }: { skip: boolean }) => useMessagingContacts({ skip }),
      { initialProps: { skip: false } },
    )
    await waitFor(() => expect(result.current.contacts.length).toBe(1))

    // skip → true : reset à []
    rerender({ skip: true })
    await waitFor(() => expect(result.current.contacts).toEqual([]))
    expect(result.current.isLoading).toBe(false)
  })
})
