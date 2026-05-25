/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le hook `useAutoClearAfter`.
 *
 * Fix CR-3 + HSA-1 + FE-3 + CR-12 round 1 review PR #435 — couvre :
 *   - clear() appelé après `ms` si value truthy
 *   - clear() PAS appelé si value falsy
 *   - cleanup au unmount (anti memory leak)
 *   - cleanup au change de value (anti concurrent timers)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useAutoClearAfter } from "@/hooks/useAutoClearAfter"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("useAutoClearAfter", () => {
  it("clear() appelé après `ms` si value truthy", () => {
    const clear = vi.fn()
    renderHook(() => useAutoClearAfter("error", clear, 4000))

    expect(clear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3999)
    expect(clear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it("clear() PAS appelé si value falsy (null/undefined/empty)", () => {
    const clear = vi.fn()
    renderHook(() => useAutoClearAfter(null, clear, 4000))
    vi.advanceTimersByTime(10000)
    expect(clear).not.toHaveBeenCalled()

    const clear2 = vi.fn()
    renderHook(() => useAutoClearAfter("", clear2, 4000))
    vi.advanceTimersByTime(10000)
    expect(clear2).not.toHaveBeenCalled()
  })

  it("Fix HSA-1/CR-3/FE-3 — cleanup au unmount (anti memory leak)", () => {
    const clear = vi.fn()
    const { unmount } = renderHook(() => useAutoClearAfter("error", clear, 4000))

    unmount()
    // Avance le temps après unmount : le timer doit être clearé
    vi.advanceTimersByTime(10000)
    expect(clear).not.toHaveBeenCalled()
  })

  it("Fix CR-3 — cleanup au change de value (anti concurrent timers)", () => {
    const clear = vi.fn()
    const { rerender } = renderHook(
      ({ value }: { value: string | null }) => useAutoClearAfter(value, clear, 4000),
      { initialProps: { value: "err1" } },
    )

    vi.advanceTimersByTime(2000)
    // Change value → nouveau timer démarré, ancien clearé
    rerender({ value: "err2" })

    vi.advanceTimersByTime(2000) // Total 4000ms depuis le 1er render
    // Le 1er timer aurait fire à 4000ms — mais a été cleared par le rerender.
    expect(clear).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2000) // Total 4000ms depuis le rerender
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it("ms par défaut = 4000", () => {
    const clear = vi.fn()
    renderHook(() => useAutoClearAfter("error", clear))
    vi.advanceTimersByTime(3999)
    expect(clear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it("ms custom respecté", () => {
    const clear = vi.fn()
    renderHook(() => useAutoClearAfter("error", clear, 1000))
    vi.advanceTimersByTime(999)
    expect(clear).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })
})
