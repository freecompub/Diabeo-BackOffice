/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `useMessageThreads` (US-2076-UI iter 2).
 *
 * Couvre :
 *   - happy fetch /api/messages → threads array + lastFetchedAt set
 *   - 401 → redirect /login?expired=1
 *   - 403 gdprConsentRequired → error `gdprConsentRevoked` + threads vide
 *   - 500/4xx → error `unexpectedError`
 *   - network error → error `networkError`
 *   - skip=true → no fetch
 *   - in-flight guard (cohérence iter 1 useUnreadCount H1)
 *   - data.items non-array → fallback []
 *   - getThreadDisplayName / getThreadAvatarInitials helpers
 *   - limit param passé à l'URL
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import {
  useMessageThreads,
  getThreadDisplayName,
  getThreadAvatarInitials,
  type ThreadListItem,
} from "@/components/diabeo/messaging/useMessageThreads"

const originalLocation = window.location

// US-2076bis-V2 (Issue #442) — `patientPublicRef` UUID v4 opaque (vs
// `patientId` numeric iter 2). 8 premiers chars affichés UI.
const TEST_PUBLIC_REF = "a3f9b8c2-4d56-7e89-0f12-345678abcdef"

function makeThread(overrides: Partial<ThreadListItem> = {}): ThreadListItem {
  return {
    conversationKey: "abc123",
    otherUserId: 7,
    patientPublicRef: TEST_PUBLIC_REF,
    lastMessage: {
      id: "msg-1",
      fromUserId: 7,
      bodyPreview: "Hello doc",
      bodyPreviewTruncated: false,
      createdAt: "2026-05-26T10:00:00Z",
      isRead: false,
    },
    unreadCount: 2,
    ...overrides,
  }
}

describe("useMessageThreads", () => {
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

  it("happy path → threads array + isInitialLoading false + lastFetchedAt set", async () => {
    const items = [makeThread({ conversationKey: "k1" }), makeThread({ conversationKey: "k2" })]
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items }),
    } as Response)

    const { result } = renderHook(() => useMessageThreads())
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false))
    expect(result.current.threads.length).toBe(2)
    expect(result.current.threads[0].conversationKey).toBe("k1")
    expect(result.current.error).toBeNull()
    expect(result.current.lastFetchedAt).toBeInstanceOf(Date)
  })

  it("URL inclut le param limit (default 100)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response)
    renderHook(() => useMessageThreads())
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/messages?limit=100",
        expect.objectContaining({ method: "GET", credentials: "include", cache: "no-store" }),
      )
    })
  })

  it("limit custom passé au backend via query string", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response)
    renderHook(() => useMessageThreads({ limit: 25 }))
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/messages?limit=25",
        expect.anything(),
      )
    })
  })

  it("401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    renderHook(() => useMessageThreads())
    await waitFor(() => expect(window.location.href).toBe("/login?expired=1"))
  })

  it("403 gdprConsentRequired → error gdprConsentRevoked + threads vide", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "gdprConsentRequired" }),
    } as Response)

    const { result } = renderHook(() => useMessageThreads())
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false))
    expect(result.current.error).toBe("gdprConsentRevoked")
    expect(result.current.threads).toEqual([])
  })

  it("500 → error unexpectedError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal" }),
    } as Response)

    const { result } = renderHook(() => useMessageThreads())
    await waitFor(() => expect(result.current.error).toBe("unexpectedError"))
  })

  it("network error → error networkError", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("networkError"))

    const { result } = renderHook(() => useMessageThreads())
    await waitFor(() => expect(result.current.error).toBe("networkError"))
  })

  it("skip=true → no fetch + threads vide", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    const { result } = renderHook(() => useMessageThreads({ skip: true }))
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.threads).toEqual([])
    expect(result.current.isInitialLoading).toBe(false)
  })

  it("data.items non-array → fallback []", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: null }),
    } as Response)

    const { result } = renderHook(() => useMessageThreads())
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false))
    expect(result.current.threads).toEqual([])
  })

  it("refetch() → re-fetch + update threads", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [makeThread({ conversationKey: "k1" })] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [makeThread({ conversationKey: "k1" }), makeThread({ conversationKey: "k2" })] }),
      } as Response)

    const { result } = renderHook(() => useMessageThreads())
    await waitFor(() => expect(result.current.threads.length).toBe(1))

    await act(async () => {
      await result.current.refetch()
    })
    expect(result.current.threads.length).toBe(2)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("in-flight guard : 2e refetch ignoré pendant 1er", async () => {
    let resolve1: ((v: Response) => void) | null = null
    const firstPromise = new Promise<Response>((resolve) => {
      resolve1 = resolve
    })
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockReturnValueOnce(firstPromise)

    const { result } = renderHook(() => useMessageThreads({ skip: true }))

    let firstResultPromise: Promise<void> | null = null
    act(() => {
      firstResultPromise = result.current.refetch()
    })

    await act(async () => {
      await result.current.refetch()
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolve1!({
        ok: true,
        json: async () => ({ items: [makeThread()] }),
      } as Response)
      await firstResultPromise
    })

    expect(result.current.threads.length).toBe(1)
  })
})

describe("getThreadDisplayName (US-2076bis-V2 Issue #442 — opaque UUID)", () => {
  it("patientPublicRef set → 'Patient #<8 first chars of UUID>'", () => {
    // Fix M6 round 1 review PR #441 — `_locale` param retiré (YAGNI iter 2).
    // US-2076bis-V2 — affiche 8 premiers chars du UUID v4 (anti-énumération).
    expect(getThreadDisplayName(makeThread({ patientPublicRef: TEST_PUBLIC_REF }))).toBe(
      "Patient #a3f9b8c2",
    )
  })

  it("patientPublicRef null → 'User #N' (staff↔staff cabinet)", () => {
    expect(
      getThreadDisplayName(makeThread({ patientPublicRef: null, otherUserId: 8 })),
    ).toBe("User #8")
  })
})

describe("getThreadAvatarInitials (US-2076bis-V2 Issue #442)", () => {
  it("patientPublicRef set → 'P'", () => {
    expect(getThreadAvatarInitials(makeThread({ patientPublicRef: TEST_PUBLIC_REF }))).toBe("P")
  })

  it("patientPublicRef null → 'U'", () => {
    expect(getThreadAvatarInitials(makeThread({ patientPublicRef: null }))).toBe("U")
  })
})
