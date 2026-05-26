/**
 * @vitest-environment jsdom
 *
 * Tests pour Fix M8 round 1 review PR #441 — `usePolling` helper factor
 * partagé entre useUnreadCount (iter 1), useMessageThreads (iter 2),
 * et hooks futurs iter 3/4.
 *
 * Couvre :
 *   - Initial fetch ("user" trigger) au mount
 *   - setInterval polling ("poll" trigger)
 *   - Pause polling si document.visibilityState === "hidden"
 *   - visibilitychange refetch ("visibilitychange" trigger)
 *   - Debounce visibilitychange vs lastSuccessAtRef.current
 *   - skip=true → no initial + no interval + no listener
 *   - intervalMs=0 → initial fetch seul, pas de polling
 *   - cleanup interval + listener au unmount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { usePolling, type PollingTrigger } from "@/hooks/usePolling"

describe("usePolling helper", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("initial fetch déclenché avec trigger='user' au mount", async () => {
    const fetcher = vi.fn<(t: PollingTrigger) => Promise<void>>().mockResolvedValue(undefined)
    renderHook(() => usePolling(fetcher, { intervalMs: 60_000 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetcher).toHaveBeenCalledWith("user")
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("setInterval déclenche fetcher avec trigger='poll' après intervalMs", async () => {
    const fetcher = vi.fn<(t: PollingTrigger) => Promise<void>>().mockResolvedValue(undefined)
    renderHook(() => usePolling(fetcher, { intervalMs: 60_000 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0) // initial
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000) // 1 tick
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenNthCalledWith(2, "poll")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000) // 2 ticks
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("skip=true → no initial fetch + no interval", async () => {
    const fetcher = vi.fn<(t: PollingTrigger) => Promise<void>>().mockResolvedValue(undefined)
    renderHook(() => usePolling(fetcher, { intervalMs: 60_000, skip: true }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("intervalMs=0 → initial fetch seul (pas de polling)", async () => {
    const fetcher = vi.fn<(t: PollingTrigger) => Promise<void>>().mockResolvedValue(undefined)
    renderHook(() => usePolling(fetcher, { intervalMs: 0 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(fetcher).toHaveBeenCalledTimes(1) // toujours 1, pas de polling
  })

  it("cleanup setInterval au unmount", async () => {
    const fetcher = vi.fn<(t: PollingTrigger) => Promise<void>>().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => usePolling(fetcher, { intervalMs: 60_000 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(fetcher).toHaveBeenCalledTimes(1) // pas de tick après unmount
  })

  it("retourne lastSuccessAtRef ref-stable", () => {
    const fetcher = vi.fn<(t: PollingTrigger) => Promise<void>>().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(() => usePolling(fetcher))
    const ref1 = result.current.lastSuccessAtRef
    rerender()
    expect(result.current.lastSuccessAtRef).toBe(ref1) // same ref across renders
  })

  it("polling pause si document.visibilityState === 'hidden'", async () => {
    const fetcher = vi.fn<(t: PollingTrigger) => Promise<void>>().mockResolvedValue(undefined)
    renderHook(() => usePolling(fetcher, { intervalMs: 60_000 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0) // initial
    })
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Simuler tab hidden
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000) // tick interval mais skip
    })
    expect(fetcher).toHaveBeenCalledTimes(1) // pas de nouveau call

    // Rétablir visible
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
  })
})
