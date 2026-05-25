/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `useConfirmAppointment` (US-2500-UI iter 11).
 *
 * Couvre :
 *   - happy 200 → { ok: true, dto }
 *   - 422 notPending → code normalisé
 *   - 403 forbidden / 404 notFound
 *   - 400 validationFailed
 *   - 401 → redirect window.location
 *   - HSA-3 whitelist : code non listé → 'unexpectedError'
 *   - fetch options POST + headers CSRF X-Requested-With
 *   - Fix H4 PR #438 : guard double-click in-flight
 *   - reset() clear error/loading
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useConfirmAppointment } from "@/components/diabeo/appointments/useConfirmAppointment"

const stubDto = {
  id: 42,
  date: "2026-06-15",
  hour: "09:30:00",
  durationMinutes: 30,
  status: "scheduled",
}

const originalLocation = window.location

describe("useConfirmAppointment", () => {
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

  it("happy path 200 → { ok: true, dto }", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => stubDto,
    } as Response)

    const { result } = renderHook(() => useConfirmAppointment())
    let res: Awaited<ReturnType<typeof result.current.submit>> | null = null
    await act(async () => {
      res = await result.current.submit(42)
    })
    expect(res).toEqual({ ok: true, dto: stubDto })
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/appointments/42/confirm",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: expect.objectContaining({ "X-Requested-With": "XMLHttpRequest" }),
      }),
    )
  })

  it("422 notPending → code normalisé", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "notPending" }),
    } as Response)

    const { result } = renderHook(() => useConfirmAppointment())
    let res: Awaited<ReturnType<typeof result.current.submit>> | null = null
    await act(async () => {
      res = await result.current.submit(42)
    })
    expect(res).toEqual({ ok: false, code: "notPending" })
    expect(result.current.error).toBe("notPending")
  })

  it("403 forbidden → code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" }),
    } as Response)

    const { result } = renderHook(() => useConfirmAppointment())
    let res: Awaited<ReturnType<typeof result.current.submit>> | null = null
    await act(async () => {
      res = await result.current.submit(42)
    })
    expect(res).toEqual({ ok: false, code: "forbidden" })
  })

  it("404 notFound → code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "notFound" }),
    } as Response)

    const { result } = renderHook(() => useConfirmAppointment())
    let res: Awaited<ReturnType<typeof result.current.submit>> | null = null
    await act(async () => {
      res = await result.current.submit(42)
    })
    expect(res).toEqual({ ok: false, code: "notFound" })
  })

  it("400 validationFailed → code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "validationFailed" }),
    } as Response)

    const { result } = renderHook(() => useConfirmAppointment())
    let res: Awaited<ReturnType<typeof result.current.submit>> | null = null
    await act(async () => {
      res = await result.current.submit(42)
    })
    expect(res).toEqual({ ok: false, code: "validationFailed" })
  })

  it("401 → redirect /login?expired=1 + return unexpectedError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    const { result } = renderHook(() => useConfirmAppointment())
    await act(async () => {
      await result.current.submit(42)
    })
    expect(window.location.href).toBe("/login?expired=1")
  })

  it("HSA-3 whitelist : code backend non listé → unexpectedError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "internalRandomBackendCode" }),
    } as Response)

    const { result } = renderHook(() => useConfirmAppointment())
    let res: Awaited<ReturnType<typeof result.current.submit>> | null = null
    await act(async () => {
      res = await result.current.submit(42)
    })
    expect(res).toEqual({ ok: false, code: "unexpectedError" })
  })

  it("network error → networkError code", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("networkError"))

    const { result } = renderHook(() => useConfirmAppointment())
    let res: Awaited<ReturnType<typeof result.current.submit>> | null = null
    await act(async () => {
      res = await result.current.submit(42)
    })
    expect(res).toEqual({ ok: false, code: "networkError" })
  })

  it("Fix H4 PR #438 : guard in-flight — 2e submit ignoré", async () => {
    let resolveFirst: ((v: Response) => void) | null = null
    const firstPromise = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    vi.spyOn(global, "fetch").mockReturnValueOnce(firstPromise)

    const { result } = renderHook(() => useConfirmAppointment())

    // 1er submit en cours (non résolu)
    let firstResultPromise: Promise<Awaited<ReturnType<typeof result.current.submit>>> | null = null
    act(() => {
      firstResultPromise = result.current.submit(42)
    })

    // 2e submit pendant le 1er → doit retourner unexpectedError (in-flight guard)
    let secondResult: Awaited<ReturnType<typeof result.current.submit>> | null = null
    await act(async () => {
      secondResult = await result.current.submit(42)
    })
    expect(secondResult).toEqual({ ok: false, code: "unexpectedError" })
    expect(global.fetch).toHaveBeenCalledTimes(1) // 2e POST ignoré

    // Résoudre le 1er
    await act(async () => {
      resolveFirst!({
        ok: true,
        json: async () => stubDto,
      } as Response)
      await firstResultPromise
    })

    // Après résolution, nouveau submit OK
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => stubDto,
    } as Response)
    let thirdResult: Awaited<ReturnType<typeof result.current.submit>> | null = null
    await act(async () => {
      thirdResult = await result.current.submit(42)
    })
    expect(thirdResult).toEqual({ ok: true, dto: stubDto })
  })

  it("reset() clear loading + error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "notPending" }),
    } as Response)

    const { result } = renderHook(() => useConfirmAppointment())
    await act(async () => {
      await result.current.submit(42)
    })
    expect(result.current.error).toBe("notPending")

    act(() => {
      result.current.reset()
    })
    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.loading).toBe(false)
  })
})
