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

  it("happy path : array backend → MessagingContact mapped", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, userId: 100 },
        { id: 2, userId: 200 },
        { id: 3, userId: 300 },
      ],
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

  it("shape `{ items: [...] }` defensive fallback", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: 5, userId: 500 }] }),
    } as Response)
    const { result } = renderHook(() => useMessagingContacts())
    await waitFor(() => expect(result.current.contacts.length).toBe(1))
    expect(result.current.contacts[0]?.displayName).toBe("Patient #5")
  })

  it("patient sans userId → filtré (defensive)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, userId: 100 },
        { id: 2 }, // missing userId
        { id: 3, userId: "not-a-number" },
      ],
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

  it("403 → error forbidden", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
    } as Response)
    const { result } = renderHook(() => useMessagingContacts())
    await waitFor(() => expect(result.current.error).toBe("forbidden"))
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
})
