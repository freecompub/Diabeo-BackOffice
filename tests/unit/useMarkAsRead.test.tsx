/**
 * @vitest-environment jsdom
 *
 * Tests pour `useMarkAsRead` (US-2076-UI iter 3).
 *
 * Couvre :
 *   - happy path 200 → ok: true
 *   - 409 alreadyRead → idempotent success (ok: true)
 *   - 404 notFound → ok: false + code notFound
 *   - 401 → redirect
 *   - network error → networkError
 *   - dedup : 2e markRead sur même id → 1 seul fetch
 *   - dedup : markedIdsRef cache idempotent local
 *   - reset() clear cache
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useMarkAsRead } from "@/components/diabeo/messaging/useMarkAsRead"

const originalLocation = window.location

describe("useMarkAsRead", () => {
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

  it("happy path 200 → ok: true + fetch correct URL/method", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "m1", readAt: "2026-05-26T10:00:00Z" }),
    } as Response)

    const { result } = renderHook(() => useMarkAsRead())
    let outcome: Awaited<ReturnType<typeof result.current.markAsRead>> | null = null
    await act(async () => {
      outcome = await result.current.markAsRead("m1")
    })
    expect(outcome).toEqual({ ok: true })
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/messages/m1/read",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "X-Requested-With": "XMLHttpRequest",
        }),
      }),
    )
  })

  it("409 alreadyRead → idempotent success (ok: true)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "alreadyRead" }),
    } as Response)

    const { result } = renderHook(() => useMarkAsRead())
    let outcome: Awaited<ReturnType<typeof result.current.markAsRead>> | null = null
    await act(async () => {
      outcome = await result.current.markAsRead("m1")
    })
    expect(outcome).toEqual({ ok: true })
  })

  it("404 notFound → ok: false + code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "notFound" }),
    } as Response)

    const { result } = renderHook(() => useMarkAsRead())
    let outcome: Awaited<ReturnType<typeof result.current.markAsRead>> | null = null
    await act(async () => {
      outcome = await result.current.markAsRead("m999")
    })
    expect(outcome).toEqual({ ok: false, code: "notFound" })
  })

  it("401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
    } as Response)

    const { result } = renderHook(() => useMarkAsRead())
    await act(async () => {
      await result.current.markAsRead("m1")
    })
    expect(window.location.href).toBe("/login?expired=1")
  })

  it("network error → networkError code", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("network"))

    const { result } = renderHook(() => useMarkAsRead())
    let outcome: Awaited<ReturnType<typeof result.current.markAsRead>> | null = null
    await act(async () => {
      outcome = await result.current.markAsRead("m1")
    })
    expect(outcome).toEqual({ ok: false, code: "networkError" })
  })

  it("dedup : 2e markAsRead sur même id → 1 seul fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "m1", readAt: "2026-05-26T10:00:00Z" }),
    } as Response)

    const { result } = renderHook(() => useMarkAsRead())
    await act(async () => {
      await result.current.markAsRead("m1")
      await result.current.markAsRead("m1")
      await result.current.markAsRead("m1")
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("markRead 2 ids différents → 2 fetchs", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "m", readAt: "2026-05-26T10:00:00Z" }),
    } as Response)

    const { result } = renderHook(() => useMarkAsRead())
    await act(async () => {
      await result.current.markAsRead("m1")
      await result.current.markAsRead("m2")
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("reset() clear cache → autorise re-markRead du même id", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "m1", readAt: "2026-05-26T10:00:00Z" }),
    } as Response)

    const { result } = renderHook(() => useMarkAsRead())
    await act(async () => {
      await result.current.markAsRead("m1")
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.reset()
    })

    await act(async () => {
      await result.current.markAsRead("m1")
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("after error 404, loading false + error code visible", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "notFound" }),
    } as Response)

    const { result } = renderHook(() => useMarkAsRead())
    await act(async () => {
      await result.current.markAsRead("m1")
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("notFound")
  })
})
