/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le hook `useMyMemberships`.
 *
 * US-2500-UI iter 4 — couvre :
 *   - Happy path : fetch initial → items + loading false + lastFetchedAt set
 *   - Error 500 → error set, items préservés (H-7 — pas de reset à [])
 *   - 401 → redirect /login?expired=1
 *   - Empty memberships → array vide (VIEWER, ADMIN sans HealthcareMember)
 *   - refetch() exposé pour bouton "Réessayer" du MemberFilter
 *
 * Fix L-7 round 2 review PR #432 — `window.location` restauré dans
 * afterEach via `originalLocation` pour éviter pollution cross-test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useMyMemberships } from "@/components/diabeo/appointments/useMyMemberships"

const mockMembership = {
  memberId: 1,
  memberName: "Dr Sophie Martin",
  serviceId: 1,
  serviceName: "Service Diabetologie",
  establishment: "CHU Paris Test",
}

// Fix L-7 round 2 review PR #432 — capture l'objet original avant
// monkey-patching pour restitution dans afterEach (anti-pollution).
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
  // Fix L-7 — restitution `window.location` original pour suites suivantes.
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: originalLocation,
  })
})

describe("useMyMemberships", () => {
  it("happy path : fetch → items + loading false + lastFetchedAt set (M-5)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [mockMembership] }),
    } as Response)

    const { result } = renderHook(() => useMyMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].memberName).toBe("Dr Sophie Martin")
    expect(result.current.error).toBeNull()
    // Fix M-5 round 2 — lastFetchedAt set après réponse OK
    // (utile pour debug + UI staleness indicator V1.5).
    expect(result.current.lastFetchedAt).toBeInstanceOf(Date)
  })

  it("refetch() exposé pour bouton Réessayer du MemberFilter", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response)

    const { result } = renderHook(() => useMyMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Trigger refetch (simulate click on "Réessayer" button)
    await result.current.refetch()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("0 memberships : array vide (VIEWER ou ADMIN orphan)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response)

    const { result } = renderHook(() => useMyMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.items).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it("error 500 : error set + items vide initial (H-7 — items préservés si déjà chargés)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "serverError" }),
    } as Response)

    const { result } = renderHook(() => useMyMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe("serverError")
    // Initial state items=null → return [] via items ?? [] mapping.
    // (H-7 round 2 — fix : si items déjà chargés, on NE reset PAS sur retry fail,
    //  UX stale-while-error.)
    expect(result.current.items).toEqual([])
  })

  it("H-7 stale-while-error : items préservés sur refetch fail après succès", async () => {
    const fetchMock = vi.spyOn(global, "fetch")
      // 1er appel : success
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [mockMembership] }),
      } as Response)
      // 2e appel (refetch) : 500
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "serverError" }),
      } as Response)

    const { result } = renderHook(() => useMyMemberships())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toHaveLength(1)

    await result.current.refetch()
    await waitFor(() => expect(result.current.error).toBe("serverError"))

    // Critical : items NE sont PAS reset à [] (UX stale-while-error)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].memberName).toBe("Dr Sophie Martin")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    renderHook(() => useMyMemberships())

    await waitFor(() => {
      expect(window.location.href).toBe("/login?expired=1")
    })
  })

  it("fetch options : cache no-store + X-Requested-With", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response)

    renderHook(() => useMyMemberships())

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.cache).toBe("no-store")
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("XMLHttpRequest")
  })
})
