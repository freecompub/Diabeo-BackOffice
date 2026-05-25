/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le hook `useUpdateAppointment`.
 *
 * US-2500-UI iter 7 — couvre :
 *   - Happy path : PUT 200 → true
 *   - 409 slotConflict → false + code normalisé
 *   - 422 appointmentNotEditable → false + code normalisé
 *   - 403 forbidden → false + code normalisé
 *   - 400 validationFailed → false + code normalisé
 *   - 404 notFound → false + code normalisé
 *   - 500 service throw → unexpectedError (whitelist HSA-3 pattern)
 *   - 401 → redirect /login?expired=1
 *   - Body request : patch (date + hour) + headers
 *   - AbortController cleanup
 *   - reset()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useUpdateAppointment } from "@/components/diabeo/appointments/useUpdateAppointment"

const validPatch = { date: "2026-06-01", hour: "14:00" }

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
  it("happy path : PUT 200 → true + loading=false", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 42 }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    let returned = false
    await act(async () => {
      returned = await result.current.submit(42, validPatch)
    })

    expect(returned).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it("409 slotConflict → false + code normalisé 'slotConflict'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "slotConflict" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    let returned = true
    await act(async () => {
      returned = await result.current.submit(42, validPatch)
    })

    expect(returned).toBe(false)
    expect(result.current.error).toBe("slotConflict")
  })

  it("422 appointmentNotEditable → false + code normalisé", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "appointmentNotEditable" }),
    } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })

    expect(result.current.error).toBe("appointmentNotEditable")
  })

  it("403 forbidden → false + code 'forbidden'", async () => {
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

  it("400 validationFailed → false + code 'validationFailed'", async () => {
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

  it("404 notFound → false + code 'notFound'", async () => {
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

  it("network error → false + 'unexpectedError' (normalisé HSA-3)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Failed to fetch"))

    const { result } = renderHook(() => useUpdateAppointment())
    let returned = true
    await act(async () => {
      returned = await result.current.submit(42, validPatch)
    })

    expect(returned).toBe(false)
    expect(result.current.error).toBe("unexpectedError")
  })

  it("fetch options : method=PUT + credentials + cache + headers + body patch", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
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
      json: async () => ({}),
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
        status: 409,
        json: async () => ({ error: "slotConflict" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response)

    const { result } = renderHook(() => useUpdateAppointment())
    await act(async () => {
      await result.current.submit(42, validPatch)
    })
    expect(result.current.error).toBe("slotConflict")

    act(() => result.current.reset())
    expect(result.current.error).toBeNull()

    let returned = false
    await act(async () => {
      returned = await result.current.submit(42, validPatch)
    })
    expect(returned).toBe(true)
  })
})
