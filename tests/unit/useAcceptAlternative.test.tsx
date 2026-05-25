/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `useAcceptAlternative` (US-2500-UI iter 9).
 *
 * Couvre les codes erreur backend specifiques accept-alternative :
 *   - happy 200 → { ok: true, dto }
 *   - 422 notCancelled / noAlternative / alternativeExpired → codes normalisés
 *   - 409 slotOverlap*  / uniqueConflict / serializationConflict
 *   - 403 forbidden / 404 notFound / 401 redirect
 *   - HSA-3 whitelist : code non listé → 'unexpectedError'
 *   - fetch options POST + no body
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import {
  useAcceptAlternative,
  type AcceptAlternativeResult,
} from "@/components/diabeo/appointments/useAcceptAlternative"

const stubDto = {
  id: 42,
  date: "2026-06-15",
  hour: "11:00:00",
  durationMinutes: 30,
  status: "scheduled",
}

const originalLocation = window.location

beforeEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: { href: "/appointments" },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: originalLocation,
  })
})

describe("useAcceptAlternative", () => {
  it("happy path 200 → { ok: true, dto }", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => stubDto,
    } as Response)

    const { result } = renderHook(() => useAcceptAlternative())
    let returned: AcceptAlternativeResult | undefined
    await act(async () => {
      returned = await result.current.submit(42)
    })

    expect(returned).toEqual({ ok: true, dto: stubDto })
    expect(result.current.error).toBeNull()
  })

  it("422 alternativeExpired (TTL 7j dépassé) → code normalisé", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "alternativeExpired" }),
    } as Response)

    const { result } = renderHook(() => useAcceptAlternative())
    await act(async () => {
      await result.current.submit(42)
    })

    expect(result.current.error).toBe("alternativeExpired")
  })

  it("422 noAlternative → code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "noAlternative" }),
    } as Response)

    const { result } = renderHook(() => useAcceptAlternative())
    await act(async () => {
      await result.current.submit(42)
    })

    expect(result.current.error).toBe("noAlternative")
  })

  it("422 notCancelled → code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "notCancelled" }),
    } as Response)

    const { result } = renderHook(() => useAcceptAlternative())
    await act(async () => {
      await result.current.submit(42)
    })

    expect(result.current.error).toBe("notCancelled")
  })

  it("422 slotOverlapAppointment (conflit nouveau créneau) → code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "slotOverlapAppointment" }),
    } as Response)

    const { result } = renderHook(() => useAcceptAlternative())
    await act(async () => {
      await result.current.submit(42)
    })

    expect(result.current.error).toBe("slotOverlapAppointment")
  })

  it("403 forbidden / 404 notFound", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "forbidden" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "notFound" }),
      } as Response)

    const { result } = renderHook(() => useAcceptAlternative())
    await act(async () => { await result.current.submit(42) })
    expect(result.current.error).toBe("forbidden")
    await act(async () => { await result.current.submit(99) })
    expect(result.current.error).toBe("notFound")
  })

  it("HSA-3 pattern — code non whitelisté → 'unexpectedError'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal DB timeout on user 42" }),
    } as Response)

    const { result } = renderHook(() => useAcceptAlternative())
    await act(async () => {
      await result.current.submit(42)
    })

    expect(result.current.error).toBe("unexpectedError")
  })

  it("401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    const { result } = renderHook(() => useAcceptAlternative())
    await act(async () => {
      await result.current.submit(42)
    })

    await waitFor(() => expect(window.location.href).toBe("/login?expired=1"))
  })

  it("fetch options : POST + credentials + cache:no-store + X-Requested-With (PAS de body)", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => stubDto,
    } as Response)

    const { result } = renderHook(() => useAcceptAlternative())
    await act(async () => {
      await result.current.submit(42)
    })

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe("POST")
    expect(init.credentials).toBe("include")
    expect(init.cache).toBe("no-store")
    const headers = init.headers as Record<string, string>
    // Fix CR-10 round 1 review PR #436 — Content-Type retiré (pas de body).
    expect(headers["Content-Type"]).toBeUndefined()
    expect(headers["X-Requested-With"]).toBe("XMLHttpRequest")
    // No body — accept-alternative est idempotent (id dans URL).
    expect(init.body).toBeUndefined()
  })

  it("URL contient l'id passé en argument", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => stubDto,
    } as Response)

    const { result } = renderHook(() => useAcceptAlternative())
    await act(async () => {
      await result.current.submit(123)
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/appointments/123/accept-alternative",
      expect.any(Object),
    )
  })
})
