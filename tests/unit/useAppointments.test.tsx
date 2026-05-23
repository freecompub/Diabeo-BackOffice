/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le hook `useAppointments`.
 *
 * Fix H-8 round 2 review PR #431 — couvre :
 *   - Happy path : fetch initial → items + isInitialLoading flag
 *   - Scope missing : skip fetch + items vide
 *   - 401 → redirect /login?expired=1
 *   - Stale-while-error : items preserved on error (H-7)
 *   - Motif stripped côté frontend (H-3 defense-in-depth)
 *   - AbortController : cleanup au unmount (H-1)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { useAppointments } from "@/components/diabeo/appointments/useAppointments"

const mockResponse = {
  items: [
    {
      id: 1, patientId: 42, memberId: 7, type: "diabeto",
      date: "2026-05-15", hour: "09:30:00", durationMinutes: 30,
      location: "in_person", status: "scheduled",
      motif: "FORBIDDEN_PHI_should_be_stripped",
      proposedAlternativeAt: null, cancelledBy: null, cancelledAt: null,
      createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z",
    },
  ],
  truncated: false,
}

beforeEach(() => {
  // Reset window.location for redirect test
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "/appointments" },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useAppointments", () => {
  it("happy path : fetch initial → items chargés + isInitialLoading false", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const { result } = renderHook(() =>
      useAppointments({
        from: new Date("2026-05-01"),
        to: new Date("2026-06-15"),
        memberId: 7,
        refreshInterval: 0, // disable polling for clean test
      }),
    )

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false)
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].id).toBe(1)
    expect(result.current.lastFetchedAt).toBeInstanceOf(Date)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain("from=2026-05-01")
    expect(url).toContain("memberId=7")
  })

  it("H-3 : motif PHI stripé côté frontend (jamais persisté state)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const { result } = renderHook(() =>
      useAppointments({
        from: new Date("2026-05-01"),
        to: new Date("2026-06-15"),
        memberId: 7,
        refreshInterval: 0,
      }),
    )

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })

    expect(result.current.items[0]).not.toHaveProperty("motif")
    expect(JSON.stringify(result.current.items)).not.toContain("FORBIDDEN_PHI")
  })

  it("scope missing : skip fetch et items vide", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const { result } = renderHook(() =>
      useAppointments({
        from: new Date("2026-05-01"),
        to: new Date("2026-06-15"),
        // No memberId, no patientId → scopeMissing
        refreshInterval: 0,
      }),
    )

    // Wait microtask to let useEffect run
    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
  })

  it("M-2 : 401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    renderHook(() =>
      useAppointments({
        from: new Date("2026-05-01"),
        to: new Date("2026-06-15"),
        memberId: 7,
        refreshInterval: 0,
      }),
    )

    await waitFor(() => {
      expect(window.location.href).toBe("/login?expired=1")
    })
  })

  it("H-7 stale-while-error : items preserved après une 1ère success puis erreur", async () => {
    const fetchMock = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "internalError" }),
      } as Response)

    const { result } = renderHook(() =>
      useAppointments({
        from: new Date("2026-05-01"),
        to: new Date("2026-06-15"),
        memberId: 7,
        refreshInterval: 0,
      }),
    )

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })

    const lastFetchedAtBeforeError = result.current.lastFetchedAt

    // Force refetch (simulate polling tick)
    await act(async () => {
      await result.current.refetch()
    })

    // Items conservés malgré l'erreur (stale-while-error UX)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.error).toBe("internalError")
    // lastFetchedAt préservé (pas reset sur error)
    expect(result.current.lastFetchedAt).toBe(lastFetchedAtBeforeError)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("H-1 cleanup AbortController au unmount", async () => {
    const abortSpy = vi.fn()
    const originalAbortController = global.AbortController
    global.AbortController = class extends originalAbortController {
      abort() {
        abortSpy()
        super.abort()
      }
    } as typeof global.AbortController

    vi.spyOn(global, "fetch").mockImplementation(
      () => new Promise(() => {}), // never resolves
    )

    const { unmount } = renderHook(() =>
      useAppointments({
        from: new Date("2026-05-01"),
        to: new Date("2026-06-15"),
        memberId: 7,
        refreshInterval: 0,
      }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    unmount()

    expect(abortSpy).toHaveBeenCalled()

    global.AbortController = originalAbortController
  })

  it("URL params correctement encodés", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    renderHook(() =>
      useAppointments({
        from: new Date("2026-05-01"),
        to: new Date("2026-06-15"),
        memberId: 7,
        status: "confirmed",
        refreshInterval: 0,
      }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain("from=2026-05-01")
    expect(url).toContain("to=2026-06-15")
    expect(url).toContain("memberId=7")
    expect(url).toContain("status=confirmed")
  })

  it("fetch utilise cache: no-store (H-2 defense-in-depth)", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    renderHook(() =>
      useAppointments({
        from: new Date("2026-05-01"),
        to: new Date("2026-06-15"),
        memberId: 7,
        refreshInterval: 0,
      }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.cache).toBe("no-store")
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("XMLHttpRequest")
  })
})
