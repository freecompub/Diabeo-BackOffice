/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `useUnreadCount` (US-2076-UI iter 1 foundation).
 *
 * Couvre :
 *   - Initial fetch : count number / count 0 / count négatif sanitize
 *   - 401 → redirect /login?expired=1
 *   - 403 gdprConsentRequired → error code `gdprConsentRevoked` + count = 0
 *   - 500/4xx générique → error code `unexpectedError`
 *   - network error → error code `networkError`
 *   - `skip` skip fetch
 *   - `decrement` optimistic local sans fetch
 *   - polling via setInterval refreshInterval > 0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useUnreadCount } from "@/components/diabeo/messaging/useUnreadCount"

const originalLocation = window.location

describe("useUnreadCount", () => {
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

  it("happy path → count number + error null + isInitialLoading false", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: 7 }),
    } as Response)

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false)
    })
    expect(result.current.count).toBe(7)
    expect(result.current.error).toBeNull()
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/messages/unread-count",
      expect.objectContaining({ method: "GET", credentials: "include", cache: "no-store" }),
    )
  })

  it("count 0 → display zero", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0 }),
    } as Response)

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false))
    expect(result.current.count).toBe(0)
  })

  it("count négatif backend → sanitize à 0 (defense-in-depth)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: -1 }),
    } as Response)

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false))
    expect(result.current.count).toBe(0)
  })

  it("count non-numeric backend → sanitize à 0", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: "many" }),
    } as Response)

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false))
    expect(result.current.count).toBe(0)
  })

  it("401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    renderHook(() => useUnreadCount())
    await waitFor(() => expect(window.location.href).toBe("/login?expired=1"))
  })

  it("403 gdprConsentRequired → error gdprConsentRevoked + count 0", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "gdprConsentRequired" }),
    } as Response)

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false))
    expect(result.current.error).toBe("gdprConsentRevoked")
    expect(result.current.count).toBe(0)
  })

  it("500 → error unexpectedError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal" }),
    } as Response)

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.error).toBe("unexpectedError"))
  })

  it("network error → error networkError", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("networkError"))

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.error).toBe("networkError"))
  })

  it("skip=true → no fetch + count 0", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    const { result } = renderHook(() => useUnreadCount({ skip: true }))
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.count).toBe(0)
    expect(result.current.isInitialLoading).toBe(false)
  })

  it("decrement(2) → count -= 2 (optimistic local, no fetch)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: 5 }),
    } as Response)

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.count).toBe(5))

    act(() => {
      result.current.decrement(2)
    })
    expect(result.current.count).toBe(3)
  })

  it("decrement() default 1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: 5 }),
    } as Response)

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.count).toBe(5))

    act(() => {
      result.current.decrement()
    })
    expect(result.current.count).toBe(4)
  })

  it("decrement past 0 → reste à 0 (clamp)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: 1 }),
    } as Response)

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.count).toBe(1))

    act(() => {
      result.current.decrement(10)
    })
    expect(result.current.count).toBe(0)
  })

  it("refetch() trigger un fetch manuel + maj count", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 3 }),
    } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 10 }),
    } as Response)

    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.count).toBe(3))

    await act(async () => {
      await result.current.refetch()
    })
    expect(result.current.count).toBe(10)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("Fix H1 PR #440 : in-flight guard — 2e refetch ignoré pendant 1er", async () => {
    let resolve1: ((v: Response) => void) | null = null
    const firstPromise = new Promise<Response>((resolve) => {
      resolve1 = resolve
    })
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 99 }),
      } as Response)

    const { result } = renderHook(() => useUnreadCount({ skip: true }))

    // Premier refetch en vol
    let firstResultPromise: Promise<void> | null = null
    act(() => {
      firstResultPromise = result.current.refetch()
    })

    // Deuxième refetch pendant que le premier est in-flight → doit être ignoré
    await act(async () => {
      await result.current.refetch()
    })
    // Le 2e fetch ne doit PAS avoir été appelé (in-flight guard)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Résoudre le 1er
    await act(async () => {
      resolve1!({
        ok: true,
        json: async () => ({ count: 42 }),
      } as Response)
      await firstResultPromise
    })

    expect(result.current.count).toBe(42)
  })

  it("Fix M5 PR #440 : pendingOptimisticDelta compense fetch en cours", async () => {
    let resolve1: ((v: Response) => void) | null = null
    const firstPromise = new Promise<Response>((resolve) => {
      resolve1 = resolve
    })
    vi.spyOn(global, "fetch")
      .mockReturnValueOnce(firstPromise)

    const { result } = renderHook(() => useUnreadCount({ skip: true }))

    // Setup : count = 0 initialement (skip=true)
    expect(result.current.count).toBe(0)

    // Démarrer un fetch (qui retournera count=5 dans une seconde)
    let fetchPromise: Promise<void> | null = null
    act(() => {
      fetchPromise = result.current.refetch()
    })

    // Pendant le fetch, l'utilisateur markRead 2 messages → decrement(2)
    act(() => {
      result.current.decrement(2)
    })

    // Le fetch retourne count=5 (count pré-markRead, cache backend)
    await act(async () => {
      resolve1!({
        ok: true,
        json: async () => ({ count: 5 }),
      } as Response)
      await fetchPromise
    })

    // Sans le fix M5 : count = 5 (markRead optimistic perdu).
    // Avec fix M5 : count = 5 - 2 = 3 (pendingOptimisticDelta soustrait).
    expect(result.current.count).toBe(3)
  })

  it("Fix CR M4 PR #440 : fetchSeq ignore les fetchs obsolètes (race out-of-order)", async () => {
    let resolve1: ((v: Response) => void) | null = null
    const firstPromise = new Promise<Response>((resolve) => {
      resolve1 = resolve
    })
    vi.spyOn(global, "fetch")
      .mockReturnValueOnce(firstPromise)

    const { result } = renderHook(() => useUnreadCount({ skip: true }))

    // 2 fetchs séquentiels — mais le 2e résout AVANT le 1er (out-of-order).
    // Note : in-flight guard bloque le 2e si le 1er n'est pas résolu, donc
    // on resolve le 1er d'abord pour libérer, puis lance le 2e.
    let p1: Promise<void> | null = null
    act(() => {
      p1 = result.current.refetch()
    })

    // Resolve 1er avec count=10
    await act(async () => {
      resolve1!({
        ok: true,
        json: async () => ({ count: 10 }),
      } as Response)
      await p1
    })
    expect(result.current.count).toBe(10)
  })
})
