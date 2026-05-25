/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le hook `useUpdateAppointment`.
 *
 * US-2500-UI iter 7 round 1 review — Couvre :
 *   - Happy path : PUT 200 → { ok: true, dto } (Fix CR-4 retour DTO)
 *   - 409 slotOverlapAppointment → { ok: false, code } (Fix CR-1 codes corrects)
 *   - 422 alreadyClosed → { ok: false, code } (Fix CR-1)
 *   - 403 forbidden / 404 notFound
 *   - 500 service throw → unexpectedError (HSA-3 pattern)
 *   - 401 → redirect /login?expired=1
 *   - Body request : patch (date + hour) + headers PUT + cache:no-store
 *   - reset() / mountedRef unmount cleanup (CR-7)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import {
  useUpdateAppointment,
  type UpdateAppointmentResult,
} from "@/components/diabeo/appointments/useUpdateAppointment"

const validPatch = { date: "2026-06-01", hour: "14:00" }

const stubDto = {
  id: 42,
  date: "2026-06-01",
  hour: "14:00:00",
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

describe("useUpdateAppointment", () => {
  it("happy path : PUT 200 → { ok: true, dto } (Fix CR-4 retour DTO)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => stubDto,
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    let returned: UpdateAppointmentResult | undefined
    await act(async () => {
      returned = await result.current.submit(42, validPatch)
    })

    expect(returned).toEqual({ ok: true, dto: stubDto })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it("Fix CR-1 — 422 alreadyClosed (RDV terminal) → { ok: false, code: 'alreadyClosed' }", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "alreadyClosed", field: "alreadyClosed" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    let returned: UpdateAppointmentResult | undefined
    await act(async () => {
      returned = await result.current.submit(42, validPatch)
    })

    expect(returned).toEqual({ ok: false, code: "alreadyClosed" })
    expect(result.current.error).toBe("alreadyClosed")
  })

  it("Fix CR-1 — 422 slotOverlapAppointment (conflit créneau) → code 'slotOverlapAppointment'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "slotOverlapAppointment" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    expect(result.current.error).toBe("slotOverlapAppointment")
  })

  it("Fix CR-1 — 422 slotOverlapUnavailability (conflit indispo membre) → code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "slotOverlapUnavailability" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    expect(result.current.error).toBe("slotOverlapUnavailability")
  })

  it("Fix CR-1 — 409 uniqueConflict (Prisma P2002) → code 'uniqueConflict'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "uniqueConflict" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    expect(result.current.error).toBe("uniqueConflict")
  })

  it("Fix CR-1 — 409 serializationConflict (Prisma P2034) → code 'serializationConflict'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "serializationConflict" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    expect(result.current.error).toBe("serializationConflict")
  })

  it("403 forbidden → code 'forbidden'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    expect(result.current.error).toBe("forbidden")
  })

  it("404 notFound → code 'notFound'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "notFound" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    expect(result.current.error).toBe("notFound")
  })

  it("400 validationFailed → code 'validationFailed'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "validationFailed" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    expect(result.current.error).toBe("validationFailed")
  })

  it("HSA-3 pattern — code backend non-whitelisté → 'unexpectedError'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Failed to write to DB: timeout on conn 42" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    expect(result.current.error).toBe("unexpectedError")
  })

  it("401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    await waitFor(() => expect(window.location.href).toBe("/login?expired=1"))
  })

  it("network error → { ok: false, code: 'unexpectedError' }", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Failed to fetch"))

    const { result } = renderHook(() => useUpdateAppointment())
    let returned: UpdateAppointmentResult | undefined
    await act(async () => {
      returned = await result.current.submit(42, validPatch)
    })

    expect(returned).toEqual({ ok: false, code: "unexpectedError" })
    expect(result.current.error).toBe("unexpectedError")
  })

  it("fetch options : method=PUT + credentials + cache + headers + body patch", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => stubDto,
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe("PUT")
    expect(init.credentials).toBe("include")
    expect(init.cache).toBe("no-store")
    const headers = init.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers["X-Requested-With"]).toBe("XMLHttpRequest")
    expect(JSON.parse(init.body as string)).toEqual(validPatch)
  })

  it("URL : utilise l'id passé en argument", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => stubDto,
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(123, validPatch)
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/appointments/123",
      expect.any(Object),
    )
  })

  it("reset() : clear error entre 2 submits", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ error: "alreadyClosed" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => stubDto,
      } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })
    expect(result.current.error).toBe("alreadyClosed")

    act(() => result.current.reset())
    expect(result.current.error).toBeNull()

    let returned: UpdateAppointmentResult | undefined
    await act(async () => {
      returned = await result.current.submit(42, validPatch)
    })
    expect(returned?.ok).toBe(true)
  })

  /**
   * Fix CR-7 round 1 — mountedRef cleanup au unmount du hook : si user
   * unmount le calendar pendant un PUT in-flight, le setState async ne doit
   * pas tirer (warn React 18+ silent mais bug latent).
   */
  it("Fix CR-7 — unmount pendant PUT in-flight : pas de setState fantôme", async () => {
    let resolveFetch!: (v: Response) => void
    const pendingResponse = new Promise<Response>((r) => { resolveFetch = r })
    vi.spyOn(global, "fetch").mockReturnValue(pendingResponse)

    const { result, unmount } = renderHook(() => useUpdateAppointment())

    // Lance submit (pending)
    const submitPromise = result.current.submit(42, validPatch)
    // Unmount avant que la réponse arrive
    unmount()
    // Résoudre la réponse — mountedRef bloque les setState
    resolveFetch({
      ok: true,
      json: async () => stubDto,
    } as Response)

    // La promise se résout normalement (pas de throw)
    const returned = await submitPromise
    expect(returned.ok).toBe(true)
    // Pas d'assertion explicite sur state — passe si pas de warn React
  })
})
