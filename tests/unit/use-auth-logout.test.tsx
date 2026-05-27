/**
 * @vitest-environment jsdom
 *
 * Tests pour `useAuth.logout()` — Issue #446 (US-2076-UI iter 4 PR #444
 * follow-up + reviews round 1 PR #449).
 *
 * Vérifie que le logout flow appelle, dans cet ordre :
 *   1. `POST /api/auth/logout` (révoque session backend EN PREMIER — Fix HSA H1)
 *   2. EN PARALLÈLE :
 *      - `DELETE /api/push/register` (cleanup backend FCM tokens — US-2073)
 *      - `unregisterMessagingServiceWorker()` (cleanup SW browser)
 *   3. Clear `sessionStorage` + `router.replace("/login")` (Fix FE H6)
 *
 * **Patterns importants** :
 * - Fire-and-forget : si une étape échoue, le logout DOIT continuer (clear
 *   + redirect). HDS Art. L.1111-8 — on ne bloque jamais la sortie de session.
 * - Observabilité C1 : chaque erreur doit être loggée via `logHookError`
 *   avec `alwaysLog: true` (sinon silent fail prod = violation HDS
 *   démonstrabilité).
 * - Double-click guard H3 : un 2e appel pendant que le 1er est in-flight
 *   est ignoré (`isLoggingOutRef`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useAuth } from "@/hooks/use-auth"
import * as swLifecycleModule from "@/lib/messaging/sw-lifecycle"
import * as sanitizeErrorModule from "@/lib/ui/sanitize-error"

// Mock next/navigation router — capture replace + push pour assertions H6.
const mockReplace = vi.fn()
const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))

// Mock next-intl translations.
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}))

// ---------------------------------------------------------------------------
// Helper L2 — factor mock fetch by URL (élimine duplication 6× dans tests).
// ---------------------------------------------------------------------------

type MockFetchBehavior = "ok" | "throw" | { delayMs: number }

interface MockFetchMap {
  [url: string]: MockFetchBehavior
}

function mockFetchByUrl(
  spy: ReturnType<typeof vi.spyOn>,
  map: MockFetchMap,
  callOrder?: string[],
): void {
  spy.mockImplementation(async (...args: Parameters<typeof fetch>) => {
    const [url] = args
    const urlStr = typeof url === "string" ? url : url.toString()
    callOrder?.push(`fetch:${urlStr}`)
    const behavior = map[urlStr] ?? "ok"
    if (behavior === "throw") throw new TypeError("Network error")
    if (typeof behavior === "object" && "delayMs" in behavior) {
      await new Promise((r) => setTimeout(r, behavior.delayMs))
    }
    return { ok: true, json: async () => ({}) } as Response
  })
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("useAuth.logout — Issue #446 + reviews round 1 PR #449", () => {
  let unregisterSpy: ReturnType<typeof vi.spyOn>
  let fetchSpy: ReturnType<typeof vi.spyOn>
  let logHookErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockReplace.mockReset()
    mockPush.mockReset()
    unregisterSpy = vi
      .spyOn(swLifecycleModule, "unregisterMessagingServiceWorker")
      .mockResolvedValue({ unregistered: true })
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)
    logHookErrorSpy = vi.spyOn(sanitizeErrorModule, "logHookError").mockImplementation(() => {})
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Ordre des appels (Fix HSA H1 — POST EN PREMIER puis [DELETE, SW] parallèle)
  // -------------------------------------------------------------------------

  it("logout appelle POST /api/auth/logout AVANT DELETE backend ET SW unregister (HSA H1)", async () => {
    const callOrder: string[] = []
    unregisterSpy.mockImplementation(async () => {
      callOrder.push("sw-unregister")
      return { unregistered: true }
    })
    mockFetchByUrl(fetchSpy, {
      "/api/auth/logout": "ok",
      "/api/push/register": "ok",
    }, callOrder)

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })

    // Étape 1 séquentielle : POST auth/logout doit être PREMIER.
    expect(callOrder[0]).toBe("fetch:/api/auth/logout")
    // Étapes 2 et 3 parallèles : DELETE backend + SW unregister APRÈS POST.
    // Ordre interne dans la paire n'est pas garanti (Promise.allSettled),
    // mais les 2 doivent être présents après l'index 0.
    const remainder = callOrder.slice(1).sort()
    expect(remainder).toEqual(["fetch:/api/push/register", "sw-unregister"])
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

  // -------------------------------------------------------------------------
  // Redirect + clear (Fix FE H6 — router.replace au lieu de router.push)
  // -------------------------------------------------------------------------

  it("redirect /login via router.REPLACE (pas push) + clear sessionStorage (FE H6)", async () => {
    sessionStorage.setItem("diabeo_session_start", String(Date.now()))
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"))
    // Critique : push NE doit PAS être appelé (back button leak protection).
    expect(mockPush).not.toHaveBeenCalled()
    expect(sessionStorage.getItem("diabeo_session_start")).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Fire-and-forget (3 scenarios + all-fail Fix M5)
  // -------------------------------------------------------------------------

  it("SW unregister fail → logout CONTINUE + logHookError appelé (C1)", async () => {
    const swError = new Error("SW unregister failed")
    unregisterSpy.mockRejectedValue(swError)
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    // DELETE backend + redirect doivent toujours s'exécuter.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/push/register",
      expect.objectContaining({ method: "DELETE" }),
    )
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"))
    // Fix C1 — observabilité prod : erreur DOIT être loggée avec alwaysLog.
    expect(logHookErrorSpy).toHaveBeenCalledWith(
      "logout.sw.unregister",
      swError,
      { alwaysLog: true },
    )
  })

  it("DELETE backend fail → logout CONTINUE + logHookError appelé (C1)", async () => {
    mockFetchByUrl(fetchSpy, {
      "/api/auth/logout": "ok",
      "/api/push/register": "throw",
    })
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    )
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"))
    expect(logHookErrorSpy).toHaveBeenCalledWith(
      "logout.fcm.delete",
      expect.any(TypeError),
      { alwaysLog: true },
    )
  })

  it("POST /api/auth/logout fail → logout CONTINUE + logHookError appelé (C1)", async () => {
    mockFetchByUrl(fetchSpy, {
      "/api/auth/logout": "throw",
      "/api/push/register": "ok",
    })
    sessionStorage.setItem("diabeo_session_start", "123")
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    // Defense-in-depth : si auth backend down, on quand même clear local + redirect.
    expect(sessionStorage.getItem("diabeo_session_start")).toBeNull()
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"))
    expect(logHookErrorSpy).toHaveBeenCalledWith(
      "logout.auth",
      expect.any(TypeError),
      { alwaysLog: true },
    )
  })

  it("Fix M5 — TOUS endpoints fail simultanément → logout CONTINUE quand même", async () => {
    unregisterSpy.mockRejectedValue(new Error("SW boom"))
    mockFetchByUrl(fetchSpy, {
      "/api/auth/logout": "throw",
      "/api/push/register": "throw",
    })
    sessionStorage.setItem("diabeo_session_start", "999")

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })

    // Triple defense : redirect + clear sessionStorage doivent quand même
    // se produire (sinon user "coincé" en session zombie HDS).
    expect(sessionStorage.getItem("diabeo_session_start")).toBeNull()
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"))

    // Les 3 erreurs doivent être loggées (forensique HDS).
    const loggedSteps = logHookErrorSpy.mock.calls.map((call: unknown[]) => call[0])
    expect(loggedSteps).toContain("logout.auth")
    expect(loggedSteps).toContain("logout.fcm.delete")
    expect(loggedSteps).toContain("logout.sw.unregister")
  })

  // -------------------------------------------------------------------------
  // Idempotence + double-click guard (Fix CR H3 + FE M4)
  // -------------------------------------------------------------------------

  it("3 endpoints appelés exactement 1 fois chacun (idempotence)", async () => {
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
    expect(unregisterSpy).toHaveBeenCalledTimes(1)
    const pushDeleteCalls = fetchSpy.mock.calls.filter(
      ([url]: Parameters<typeof fetch>) =>
        typeof url === "string" && url === "/api/push/register",
    )
    expect(pushDeleteCalls).toHaveLength(1)
    const authLogoutCalls = fetchSpy.mock.calls.filter(
      ([url]: Parameters<typeof fetch>) =>
        typeof url === "string" && url === "/api/auth/logout",
    )
    expect(authLogoutCalls).toHaveLength(1)
  })

  it("Fix H3 — double-click logout : 2e appel ignoré pendant in-flight", async () => {
    // POST auth/logout retardé 50ms → permet de lancer un 2e logout concurrent.
    mockFetchByUrl(fetchSpy, {
      "/api/auth/logout": { delayMs: 50 },
      "/api/push/register": "ok",
    })

    const { result } = renderHook(() => useAuth())

    // Lance 2 logouts concurrent — le 2e doit early-return sans appel.
    await act(async () => {
      const p1 = result.current.logout()
      const p2 = result.current.logout()
      await Promise.all([p1, p2])
    })

    // 1 seul POST + 1 seul DELETE + 1 seul SW unregister malgré 2 invocations.
    expect(unregisterSpy).toHaveBeenCalledTimes(1)
    const pushDeleteCalls = fetchSpy.mock.calls.filter(
      ([url]: Parameters<typeof fetch>) =>
        typeof url === "string" && url === "/api/push/register",
    )
    expect(pushDeleteCalls).toHaveLength(1)
    const authLogoutCalls = fetchSpy.mock.calls.filter(
      ([url]: Parameters<typeof fetch>) =>
        typeof url === "string" && url === "/api/auth/logout",
    )
    expect(authLogoutCalls).toHaveLength(1)
    // 1 seul replace malgré 2 calls (le 2e early return avant finally).
    expect(mockReplace).toHaveBeenCalledTimes(1)
  })
})
