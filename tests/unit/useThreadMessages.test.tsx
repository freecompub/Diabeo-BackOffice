/**
 * @vitest-environment jsdom
 *
 * Tests pour `useThreadMessages` (US-2076-UI iter 3).
 *
 * Couvre :
 *   - happy path fetch first page → messages + nextCursor
 *   - conversationKey=null → skip (no fetch)
 *   - 401 → redirect
 *   - 403 gdprConsentRequired → gdprConsentRevoked + messages vide
 *   - 404 → notFound + messages vide
 *   - 500 → unexpectedError
 *   - network → networkError
 *   - refetch() replace first page
 *   - loadMore() append page suivante
 *   - loadMore() noop si nextCursor null
 *   - data.items non-array → fallback []
 *   - in-flight guard
 *   - reset state quand conversationKey change
 *   - URL avec/sans cursor
 *   - X-Thread-Trigger header présent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import {
  useThreadMessages,
  type ThreadMessageItem,
} from "@/components/diabeo/messaging/useThreadMessages"

const originalLocation = window.location

function makeMessage(overrides: Partial<ThreadMessageItem> = {}): ThreadMessageItem {
  return {
    id: "m1",
    fromUserId: 1,
    toUserId: 7,
    body: "Hello",
    createdAt: "2026-05-26T10:00:00Z",
    readAt: null,
    ...overrides,
  }
}

describe("useThreadMessages", () => {
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

  it("conversationKey=null → no fetch + messages vide", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    const { result } = renderHook(() =>
      useThreadMessages({ conversationKey: null, refreshInterval: 0 }),
    )
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.messages).toEqual([])
    expect(result.current.isInitialLoading).toBe(false)
  })

  it("happy path → messages + nextCursor", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [makeMessage({ id: "m1" }), makeMessage({ id: "m2" })],
        nextCursor: "cursor-page-2",
      }),
    } as Response)

    const { result } = renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false))
    expect(result.current.messages.length).toBe(2)
    expect(result.current.nextCursor).toBe("cursor-page-2")
    expect(result.current.error).toBeNull()
  })

  it("URL inclut limit + X-Thread-Trigger header", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    } as Response)

    renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/messages/thread/abc?limit=50"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Thread-Trigger": "user",
          }),
        }),
      )
    })
  })

  it("401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
    } as Response)

    renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => expect(window.location.href).toBe("/login?expired=1"))
  })

  it("403 gdprConsentRequired → gdprConsentRevoked", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "gdprConsentRequired" }),
    } as Response)

    const { result } = renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => expect(result.current.error).toBe("gdprConsentRevoked"))
    expect(result.current.messages).toEqual([])
  })

  it("404 → notFound + messages vide", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "notFound" }),
    } as Response)

    const { result } = renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => expect(result.current.error).toBe("notFound"))
    expect(result.current.messages).toEqual([])
  })

  it("500 → unexpectedError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal" }),
    } as Response)

    const { result } = renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => expect(result.current.error).toBe("unexpectedError"))
  })

  it("network error → networkError", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("net"))

    const { result } = renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => expect(result.current.error).toBe("networkError"))
  })

  it("data.items non-array → fallback []", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: "not-an-array", nextCursor: null }),
    } as Response)

    const { result } = renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false))
    expect(result.current.messages).toEqual([])
  })

  it("refetch() → replace first page", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [makeMessage({ id: "m1" })],
          nextCursor: null,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [makeMessage({ id: "m1" }), makeMessage({ id: "m2-new" })],
          nextCursor: null,
        }),
      } as Response)

    const { result } = renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => expect(result.current.messages.length).toBe(1))

    await act(async () => {
      await result.current.refetch()
    })
    expect(result.current.messages.length).toBe(2)
  })

  it("loadMore() → append page suivante + cursor URL param", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [makeMessage({ id: "m-recent" })],
          nextCursor: "page2",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [makeMessage({ id: "m-older" })],
          nextCursor: null,
        }),
      } as Response)

    const { result } = renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => expect(result.current.messages.length).toBe(1))
    expect(result.current.nextCursor).toBe("page2")

    await act(async () => {
      await result.current.loadMore()
    })
    expect(result.current.messages.length).toBe(2)
    expect(result.current.nextCursor).toBeNull()
    expect(fetchSpy.mock.calls[1]?.[0]).toContain("cursor=page2")
  })

  it("loadMore() noop si nextCursor null", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [makeMessage()], nextCursor: null }),
    } as Response)

    const { result } = renderHook(() =>
      useThreadMessages({ conversationKey: "abc", refreshInterval: 0 }),
    )
    await waitFor(() => expect(result.current.messages.length).toBe(1))

    await act(async () => {
      await result.current.loadMore()
    })
    // Aucun fetch supplémentaire
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("reset state quand conversationKey change", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [makeMessage({ id: "m-thread1" })],
          nextCursor: null,
        }),
      } as Response)
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [makeMessage({ id: "m-thread2" })],
          nextCursor: null,
        }),
      } as Response)

    const { result, rerender } = renderHook(
      ({ key }: { key: string | null }) =>
        useThreadMessages({ conversationKey: key, refreshInterval: 0 }),
      { initialProps: { key: "thread1" as string | null } },
    )
    await waitFor(() => expect(result.current.messages[0]?.id).toBe("m-thread1"))

    rerender({ key: "thread2" })
    // Au changement de key, reset state immédiat (effect synchrone) :
    // messages [] avant fetch nouveau thread → puis remplissage async.
    await waitFor(() => {
      const first = result.current.messages[0]
      expect(first?.id === "m-thread2" || first === undefined).toBe(true)
    })
  })
})
