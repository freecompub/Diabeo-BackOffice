/**
 * @vitest-environment jsdom
 *
 * Tests pour `useAuth.logout()` — Issue #446 (US-2076-UI iter 4 PR #444 follow-up).
 *
 * Vérifie que le logout flow appelle :
 *   1. `unregisterMessagingServiceWorker()` (cleanup SW browser)
 *   2. `DELETE /api/push/register` (cleanup backend FCM tokens)
 *   3. `POST /api/auth/logout` (invalidation session)
 *   4. Clear `sessionStorage` + redirect `/login`
 *
 * Pattern fire-and-forget : si SW unregister ou DELETE backend fail, le
 * logout DOIT TOUJOURS continuer (clear cookie + redirect). On ne bloque
 * jamais la sortie de session sur cleanup tierce (HDS Art. L.1111-8).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useAuth } from "@/hooks/use-auth"
import * as useMessagingPushModule from "@/components/diabeo/messaging/useMessagingPush"

// Mock next/navigation router.
const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

// Mock next-intl translations.
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}))

describe("useAuth.logout — Issue #446 FCM cleanup", () => {
  let unregisterSpy: ReturnType<typeof vi.spyOn>
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockPush.mockReset()
    unregisterSpy = vi.spyOn(
      useMessagingPushModule,
      "unregisterMessagingServiceWorker",
    ).mockResolvedValue(undefined)
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)
    // Reset sessionStorage entre tests.
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("logout appelle unregisterMessagingServiceWorker AVANT DELETE backend", async () => {
    const callOrder: string[] = []
    unregisterSpy.mockImplementation(async () => {
      callOrder.push("sw-unregister")
    })
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString()
      callOrder.push(`fetch:${urlStr}`)
      return { ok: true, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })

    expect(callOrder).toEqual([
      "sw-unregister",
      "fetch:/api/push/register",
      "fetch:/api/auth/logout",
    ])
  })

  it("DELETE /api/push/register avec CSRF header X-Requested-With", async () => {
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/push/register",
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
        headers: expect.objectContaining({
          "X-Requested-With": "XMLHttpRequest",
        }),
      }),
    )
  })

  it("redirect /login + clear sessionStorage à la fin", async () => {
    sessionStorage.setItem("diabeo_session_start", String(Date.now()))
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"))
    expect(sessionStorage.getItem("diabeo_session_start")).toBeNull()
  })

  it("SW unregister fail → logout CONTINUE (fire-and-forget)", async () => {
    unregisterSpy.mockRejectedValue(new Error("SW unregister failed"))
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    // Logout doit toujours redirect + DELETE backend tokens même si SW fail.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/push/register",
      expect.objectContaining({ method: "DELETE" }),
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"))
  })

  it("DELETE backend fail → logout CONTINUE (fire-and-forget)", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString()
      if (urlStr.includes("/api/push/register")) {
        throw new TypeError("Network error")
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    // Logout auth POST + redirect doivent toujours s'exécuter.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"))
  })

  it("POST /api/auth/logout fail → logout CONTINUE (clear + redirect)", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = typeof url === "string" ? url : url.toString()
      if (urlStr.includes("/api/auth/logout")) {
        throw new TypeError("Network error")
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    sessionStorage.setItem("diabeo_session_start", "123")
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    // Defense-in-depth : si auth backend down, on quand même clear local + redirect.
    expect(sessionStorage.getItem("diabeo_session_start")).toBeNull()
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"))
  })

  it("3 endpoints appelés exactement 1 fois chacun (idempotence)", async () => {
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    expect(unregisterSpy).toHaveBeenCalledTimes(1)
    const pushDeleteCalls = fetchSpy.mock.calls.filter(
      ([url]: [unknown]) => typeof url === "string" && url === "/api/push/register",
    )
    expect(pushDeleteCalls).toHaveLength(1)
    const authLogoutCalls = fetchSpy.mock.calls.filter(
      ([url]: [unknown]) => typeof url === "string" && url === "/api/auth/logout",
    )
    expect(authLogoutCalls).toHaveLength(1)
  })
})
