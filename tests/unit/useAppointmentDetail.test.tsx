/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le hook `useAppointmentDetail`.
 *
 * US-2500-UI iter 5 — couvre :
 *   - id=null → idle (pas de fetch, detail null)
 *   - id set → fetch + detail populé
 *   - id change → abort previous + new fetch
 *   - id passe à null → state reset + abort
 *   - 401 → redirect /login?expired=1
 *   - 404 → error set
 *   - networkError → error set
 *
 * **Note** : on ne teste pas l'audit READ tiré côté backend (c'est une
 * propriété du service, déjà testée dans `tests/unit/rdv.service.test.ts`).
 * Ici on garantit que le client n'émet pas de fetch fantôme.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { useAppointmentDetail } from "@/components/diabeo/appointments/useAppointmentDetail"

const mockDetail = {
  id: 42,
  patientId: 7,
  memberId: 1,
  type: "diabeto",
  date: "2026-05-25",
  hour: "09:30:00",
  durationMinutes: 30,
  location: "in_person",
  status: "confirmed",
  motif: "Titration basale",
  note: null,
  proposedAlternativeAt: null,
  cancelledBy: null,
  cancelReason: null,
  cancelledAt: null,
  createdAt: "2026-05-20T10:00:00Z",
  updatedAt: "2026-05-20T10:00:00Z",
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

describe("useAppointmentDetail", () => {
  it("id=null → idle (pas de fetch, detail=null)", async () => {
    const fetchMock = vi.spyOn(global, "fetch")
    const { result } = renderHook(() => useAppointmentDetail(null))
    // Pas de fetch tiré.
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.detail).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it("id set → fetch + detail populé + audit côté backend (transparent côté hook)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockDetail,
    } as Response)

    const { result } = renderHook(() => useAppointmentDetail(42))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.detail?.id).toBe(42)
    expect(result.current.detail?.motif).toBe("Titration basale")
    expect(result.current.error).toBeNull()
  })

  it("id change → fetch second appointment, reset detail intermediate", async () => {
    const fetchMock = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockDetail,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockDetail, id: 99, motif: "Autre RDV" }),
      } as Response)

    const { result, rerender } = renderHook(
      ({ id }: { id: number | null }) => useAppointmentDetail(id),
      { initialProps: { id: 42 } },
    )

    await waitFor(() => expect(result.current.detail?.id).toBe(42))

    // Change id → nouveau fetch.
    rerender({ id: 99 })

    await waitFor(() => expect(result.current.detail?.id).toBe(99))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/appointments/42",
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/appointments/99",
      expect.any(Object),
    )
  })

  it("id passe de set à null → state reset (modal close)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockDetail,
    } as Response)

    const { result, rerender } = renderHook(
      ({ id }: { id: number | null }) => useAppointmentDetail(id),
      { initialProps: { id: 42 } as { id: number | null } },
    )

    await waitFor(() => expect(result.current.detail?.id).toBe(42))

    // Close modal (id=null) → detail reset.
    rerender({ id: null })

    await waitFor(() => {
      expect(result.current.detail).toBeNull()
    })
    expect(result.current.loading).toBe(false)
  })

  it("401 → redirect /login?expired=1 (JWT expired)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    renderHook(() => useAppointmentDetail(42))

    await waitFor(() => {
      expect(window.location.href).toBe("/login?expired=1")
    })
  })

  it("404 → error set sans throw", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "notFound" }),
    } as Response)

    const { result } = renderHook(() => useAppointmentDetail(9999))
    await waitFor(() => expect(result.current.error).toBe("notFound"))
    expect(result.current.detail).toBeNull()
  })

  it("networkError → error set sans throw", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Failed to fetch"))

    const { result } = renderHook(() => useAppointmentDetail(42))
    await waitFor(() => expect(result.current.error).toBe("Failed to fetch"))
    expect(result.current.detail).toBeNull()
  })

  it("fetch options : cache no-store + X-Requested-With + credentials include", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockDetail,
    } as Response)

    renderHook(() => useAppointmentDetail(42))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.cache).toBe("no-store")
    expect(init.credentials).toBe("include")
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("XMLHttpRequest")
  })

  it("refetch() force un nouveau fetch (pour bouton retry post-error)", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockDetail,
    } as Response)

    const { result } = renderHook(() => useAppointmentDetail(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refetch()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  /**
   * Fix H-2 round 1 review PR #433 — race fetch obsolète.
   *
   * Scénario : id change rapidement (user clique 2 RDV successifs avant que
   * le 1er fetch retourne). Le vieux fetch ne doit PAS reset `loading=false`
   * pendant que le nouveau est en cours (glitch UX visible).
   *
   * Mécanique testée : capture locale `const myCtrl = ctrl` dans le `try`
   * → le `finally` du vieux fetch teste `myCtrl.signal.aborted` (true car
   * abort a été appelé par le nouveau fetch) → skip setLoading(false).
   */
  it("H-2 race — id change rapide : vieux fetch ne reset PAS loading du nouveau", async () => {
    let resolveFirst!: (v: Response) => void
    const firstResponse = new Promise<Response>((r) => { resolveFirst = r })
    let resolveSecond!: (v: Response) => void
    const secondResponse = new Promise<Response>((r) => { resolveSecond = r })

    vi.spyOn(global, "fetch")
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse)

    const { result, rerender } = renderHook(
      ({ id }: { id: number | null }) => useAppointmentDetail(id),
      { initialProps: { id: 42 } as { id: number | null } },
    )
    // Loading true au mount
    await waitFor(() => expect(result.current.loading).toBe(true))

    // Change id avant que le 1er fetch retourne
    rerender({ id: 99 })
    // Loading reste true (nouveau fetch en cours)
    await waitFor(() => expect(result.current.loading).toBe(true))

    // Maintenant on résout le VIEUX fetch (qui a été abort par le nouveau).
    // Son `finally` ne doit PAS setLoading(false) car `myCtrl.signal.aborted=true`.
    await act(async () => {
      resolveFirst({ ok: true, json: async () => mockDetail } as Response)
      // wait a tick pour que le `finally` du vieux fetch s'exécute
      await Promise.resolve()
    })
    // Loading toujours true → le vieux fetch n'a pas perturbé
    expect(result.current.loading).toBe(true)

    // Le nouveau fetch se résout normalement
    await act(async () => {
      resolveSecond({ ok: true, json: async () => ({ ...mockDetail, id: 99 }) } as Response)
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.detail?.id).toBe(99)
  })
})
