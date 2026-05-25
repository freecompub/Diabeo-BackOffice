/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le hook `useCreateAppointment`.
 *
 * US-2500-UI iter 6 — couvre :
 *   - Happy path : POST 201 → retourne newId
 *   - Validation 400 → retourne null + error code
 *   - Forbidden 403 (canAccessPatient) → retourne null + error code
 *   - Conflict 409 (EXCLUDE GiST slot membre) → retourne null + error code
 *   - 401 → redirect /login?expired=1
 *   - Network error → retourne null + networkError code
 *   - Body request : Content-Type + credentials + cache:no-store + X-Requested-With
 *   - reset() : reset state entre 2 submits
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useCreateAppointment } from "@/components/diabeo/appointments/useCreateAppointment"

const validInput = {
  patientId: 7,
  memberId: 1,
  date: "2026-05-25",
  hour: "09:30",
  durationMinutes: 30,
  location: "in_person" as const,
  type: "diabeto",
  motif: "Titration basale",
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

describe("useCreateAppointment", () => {
  it("happy path : POST 201 → retourne newId + loading=false", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 42 }),
    } as Response)

    const { result } = renderHook(() => useCreateAppointment())
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()

    let returned: number | null = null
    await act(async () => {
      returned = await result.current.submit(validInput)
    })

    expect(returned).toBe(42)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it("400 validation → retourne null + code normalisé 'validationFailed'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "validationFailed" }),
    } as Response)

    const { result } = renderHook(() => useCreateAppointment())
    let returned: number | null = 999
    await act(async () => {
      returned = await result.current.submit(validInput)
    })

    expect(returned).toBeNull()
    expect(result.current.error).toBe("validationFailed")
  })

  it("403 forbidden → retourne null + code normalisé 'forbidden'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" }),
    } as Response)

    const { result } = renderHook(() => useCreateAppointment())
    let returned: number | null = 999
    await act(async () => {
      returned = await result.current.submit(validInput)
    })

    expect(returned).toBeNull()
    expect(result.current.error).toBe("forbidden")
  })

  it("409 conflict slot (EXCLUDE GiST) → retourne null + code 'slotConflict'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "slotConflict" }),
    } as Response)

    const { result } = renderHook(() => useCreateAppointment())
    let returned: number | null = 999
    await act(async () => {
      returned = await result.current.submit(validInput)
    })

    expect(returned).toBeNull()
    expect(result.current.error).toBe("slotConflict")
  })

  it("HSA-3 round 1 — backend code non-whitelisté → normalisé 'unexpectedError' (defense-in-depth)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      // Simule un leak verbeux backend : "Failed to decrypt motif for patient 4242"
      json: async () => ({ error: "Failed to decrypt motif for patient 4242: invalid GCM tag" }),
    } as Response)

    const { result } = renderHook(() => useCreateAppointment())
    await act(async () => {
      await result.current.submit(validInput)
    })

    // Code normalisé vs raw — empêche futur dev d'afficher message PHI brut.
    expect(result.current.error).toBe("unexpectedError")
  })

  it("HSA-3 round 1 — body.error absent → 'unexpectedError'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    const { result } = renderHook(() => useCreateAppointment())
    await act(async () => {
      await result.current.submit(validInput)
    })

    expect(result.current.error).toBe("unexpectedError")
  })

  it("401 → redirect /login?expired=1 (auth perdue)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    const { result } = renderHook(() => useCreateAppointment())
    await act(async () => {
      await result.current.submit(validInput)
    })

    await waitFor(() => expect(window.location.href).toBe("/login?expired=1"))
  })

  it("network error → retourne null + code normalisé 'unexpectedError' (whitelist)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Failed to fetch"))

    const { result } = renderHook(() => useCreateAppointment())
    let returned: number | null = 999
    await act(async () => {
      returned = await result.current.submit(validInput)
    })

    expect(returned).toBeNull()
    // Fix HSA-3 round 1 — message brut "Failed to fetch" non-whitelisté →
    // normalisé "unexpectedError" pour empêcher leak verbeux dans state React.
    expect(result.current.error).toBe("unexpectedError")
  })

  it("fetch options : credentials + cache:no-store + X-Requested-With + Content-Type", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    } as Response)

    const { result } = renderHook(() => useCreateAppointment())
    await act(async () => {
      await result.current.submit(validInput)
    })

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe("POST")
    expect(init.credentials).toBe("include")
    expect(init.cache).toBe("no-store")
    const headers = init.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers["X-Requested-With"]).toBe("XMLHttpRequest")
    expect(JSON.parse(init.body as string)).toEqual(validInput)
  })

  it("reset() : reset error entre 2 submits", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "validationFailed" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 99 }),
      } as Response)

    const { result } = renderHook(() => useCreateAppointment())
    await act(async () => {
      await result.current.submit(validInput)
    })
    expect(result.current.error).toBe("validationFailed")

    act(() => result.current.reset())
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)

    let returned: number | null = null
    await act(async () => {
      returned = await result.current.submit(validInput)
    })
    expect(returned).toBe(99)
  })
})
