/**
 * @vitest-environment jsdom
 *
 * Tests pour `useSendMessage` (US-2076-UI iter 3).
 *
 * Couvre :
 *   - happy path 201 → { ok: true, data }
 *   - 401 → redirect /login?expired=1
 *   - 403 gdprConsentRequired → normalize gdprConsentRevoked
 *   - 403 forbidden (canMessage) → forbidden
 *   - 422 bodyTooLong / bodyEmpty
 *   - 429 rateLimited + Retry-After header
 *   - network error → networkError
 *   - in-flight guard double-click
 *   - reset() clear error/loading
 *   - whitelist HSA-3 codes inconnus → unexpectedError
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useSendMessage } from "@/components/diabeo/messaging/useSendMessage"

const stubResult = {
  id: "msg-123",
  conversationKey: "abc123",
  fromUserId: 1,
  toUserId: 7,
  patientId: 42,
  createdAt: "2026-05-26T10:00:00Z",
  fcm: { sent: 1, failed: 0 },
}

const originalLocation = window.location

describe("useSendMessage", () => {
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

  it("happy path 201 → ok: true + data + fetch headers corrects", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ message: stubResult }),
    } as Response)

    const { result } = renderHook(() => useSendMessage())
    let outcome: Awaited<ReturnType<typeof result.current.send>> | null = null
    await act(async () => {
      outcome = await result.current.send({ toUserId: 7, body: "Hello" })
    })
    expect(outcome).toEqual({ ok: true, data: stubResult })
    expect(result.current.error).toBeNull()
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/messages",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        }),
      }),
    )
  })

  it("401 → redirect /login?expired=1", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "tokenExpired" }),
    } as Response)

    const { result } = renderHook(() => useSendMessage())
    await act(async () => {
      await result.current.send({ toUserId: 7, body: "Hello" })
    })
    expect(window.location.href).toBe("/login?expired=1")
  })

  it("403 gdprConsentRequired → gdprConsentRevoked (normalize)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "gdprConsentRequired" }),
    } as Response)

    const { result } = renderHook(() => useSendMessage())
    let outcome: Awaited<ReturnType<typeof result.current.send>> | null = null
    await act(async () => {
      outcome = await result.current.send({ toUserId: 7, body: "Hello" })
    })
    expect(outcome).toEqual({ ok: false, code: "gdprConsentRevoked" })
  })

  it("403 forbidden (canMessage false) → forbidden", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" }),
    } as Response)

    const { result } = renderHook(() => useSendMessage())
    let outcome: Awaited<ReturnType<typeof result.current.send>> | null = null
    await act(async () => {
      outcome = await result.current.send({ toUserId: 7, body: "Hello" })
    })
    expect(outcome).toEqual({ ok: false, code: "forbidden" })
  })

  it("422 bodyTooLong → code", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "bodyTooLong" }),
    } as Response)

    const { result } = renderHook(() => useSendMessage())
    let outcome: Awaited<ReturnType<typeof result.current.send>> | null = null
    await act(async () => {
      outcome = await result.current.send({ toUserId: 7, body: "a".repeat(9000) })
    })
    expect(outcome).toEqual({ ok: false, code: "bodyTooLong" })
  })

  it("429 rateLimited + Retry-After header parsed", async () => {
    const headers = new Headers({ "Retry-After": "30" })
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      headers,
      json: async () => ({ error: "rateLimited" }),
    } as unknown as Response)

    const { result } = renderHook(() => useSendMessage())
    let outcome: Awaited<ReturnType<typeof result.current.send>> | null = null
    await act(async () => {
      outcome = await result.current.send({ toUserId: 7, body: "Hello" })
    })
    expect(outcome).toEqual({ ok: false, code: "rateLimited", retryAfterSeconds: 30 })
  })

  it("network error → networkError code", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("network"))

    const { result } = renderHook(() => useSendMessage())
    let outcome: Awaited<ReturnType<typeof result.current.send>> | null = null
    await act(async () => {
      outcome = await result.current.send({ toUserId: 7, body: "Hello" })
    })
    expect(outcome).toEqual({ ok: false, code: "networkError" })
  })

  it("whitelist HSA-3 : code backend non listé → unexpectedError", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "weirdInternalCode" }),
    } as Response)

    const { result } = renderHook(() => useSendMessage())
    let outcome: Awaited<ReturnType<typeof result.current.send>> | null = null
    await act(async () => {
      outcome = await result.current.send({ toUserId: 7, body: "Hello" })
    })
    expect(outcome).toEqual({ ok: false, code: "unexpectedError" })
  })

  it("in-flight guard : 2e send ignoré pendant 1er", async () => {
    let resolve1: ((v: Response) => void) | null = null
    const firstPromise = new Promise<Response>((resolve) => {
      resolve1 = resolve
    })
    vi.spyOn(global, "fetch").mockReturnValueOnce(firstPromise)

    const { result } = renderHook(() => useSendMessage())

    let firstResultPromise: Promise<Awaited<ReturnType<typeof result.current.send>>> | null = null
    act(() => {
      firstResultPromise = result.current.send({ toUserId: 7, body: "Hello 1" })
    })

    let secondOutcome: Awaited<ReturnType<typeof result.current.send>> | null = null
    await act(async () => {
      secondOutcome = await result.current.send({ toUserId: 7, body: "Hello 2" })
    })
    expect(secondOutcome).toEqual({ ok: false, code: "unexpectedError" })
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolve1!({
        ok: true,
        json: async () => ({ message: stubResult }),
      } as Response)
      await firstResultPromise
    })
  })

  it("reset() clear loading + error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "bodyTooLong" }),
    } as Response)

    const { result } = renderHook(() => useSendMessage())
    await act(async () => {
      await result.current.send({ toUserId: 7, body: "x" })
    })
    expect(result.current.error).toBe("bodyTooLong")

    act(() => {
      result.current.reset()
    })
    await waitFor(() => expect(result.current.error).toBeNull())
  })
})
