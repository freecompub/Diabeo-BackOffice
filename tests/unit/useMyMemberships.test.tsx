/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le hook `useMyMemberships`.
 *
 * US-2500-UI iter 4 — couvre :
 *   - Happy path : fetch initial → items + loading false
 *   - Error 500 → error set, items vide
 *   - 401 → redirect /login?expired=1
 *   - Empty memberships → array vide (VIEWER, ADMIN sans HealthcareMember)
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

beforeEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "/appointments" },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useMyMemberships", () => {
  it("happy path : fetch → items + loading false", async () => {
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

  it("error 500 : error set + items vide", async () => {
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
    expect(result.current.items).toEqual([])
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
