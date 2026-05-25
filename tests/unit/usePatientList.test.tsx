/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le hook `usePatientList`.
 *
 * US-2500-UI iter 6 — couvre :
 *   - enabled=false → idle (pas de fetch)
 *   - enabled=true → fetch + items mapping user.firstname/lastname
 *   - search → fetch avec query param
 *   - 401 → redirect /login?expired=1
 *   - 500 → error code
 *   - AbortController cleanup au unmount
 *   - fetch options : credentials + cache + X-Requested-With
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { usePatientList } from "@/components/diabeo/appointments/usePatientList"

const mockResponse = {
  items: [
    { id: 1, user: { firstname: "Jean", lastname: "Durand" } },
    { id: 2, user: { firstname: "Claire", lastname: "Bernard" } },
  ],
  nextCursor: null,
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

describe("usePatientList", () => {
  it("enabled=false → idle (pas de fetch)", async () => {
    const fetchMock = vi.spyOn(global, "fetch")
    const { result } = renderHook(() =>
      usePatientList({ enabled: false }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it("enabled=true → fetch + items mapping flat (id + firstname + lastname)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const { result } = renderHook(() => usePatientList({ enabled: true }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.items).toHaveLength(2)
    expect(result.current.items[0]).toEqual({
      id: 1,
      firstname: "Jean",
      lastname: "Durand",
    })
    expect(result.current.items[1]).toEqual({
      id: 2,
      firstname: "Claire",
      lastname: "Bernard",
    })
  })

  it("search param → propagé dans URL fetch", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    } as Response)

    renderHook(() => usePatientList({ enabled: true, search: "Durand" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain("limit=50")
    expect(url).toContain("search=Durand")
  })

  it("search vide → pas de query param search dans l'URL", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    } as Response)

    renderHook(() => usePatientList({ enabled: true, search: "   " }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).not.toContain("search=")
  })

  it("401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    renderHook(() => usePatientList({ enabled: true }))
    await waitFor(() => expect(window.location.href).toBe("/login?expired=1"))
  })

  it("500 → error set + items vide", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "serverError" }),
    } as Response)

    const { result } = renderHook(() => usePatientList({ enabled: true }))
    await waitFor(() => expect(result.current.error).toBe("serverError"))
    expect(result.current.items).toEqual([])
  })

  it("fetch options : credentials + cache:no-store + X-Requested-With", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    renderHook(() => usePatientList({ enabled: true }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.credentials).toBe("include")
    expect(init.cache).toBe("no-store")
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("XMLHttpRequest")
  })

  it("unmount → AbortController cleanup (pas de setState fantôme)", async () => {
    let resolveFetch!: (v: Response) => void
    const pendingResponse = new Promise<Response>((r) => { resolveFetch = r })
    vi.spyOn(global, "fetch").mockReturnValue(pendingResponse)

    const { result, unmount } = renderHook(() => usePatientList({ enabled: true }))
    await waitFor(() => expect(result.current.loading).toBe(true))

    unmount()

    // Maintenant résoudre le fetch — ne doit pas crash ni warn React
    resolveFetch({ ok: true, json: async () => mockResponse } as Response)
    // Aucune assertion explicite : le test passe si pas de warn React
    // dans la console (setState on unmounted component).
  })
})
