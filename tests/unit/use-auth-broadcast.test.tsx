/**
 * @vitest-environment jsdom
 *
 * Tests pour Issue #450 — cross-tab logout sync via `BroadcastChannel("diabeo:auth")`
 * (follow-up review HSA M2 PR #449).
 *
 * **Risque HDS Art. L.1111-8 résolu** : sur poste partagé cabinet multi-PS,
 * si PS A logout dans tab 1 mais laisse tab 2 ouvert, ce dernier peut
 * ré-register un token FCM via `useMessagingPush` mount cycle (annulant le
 * cleanup tab 1). PS B login peu après → tokens PS A persistent sous identité
 * PS A → cron messagerie push arrive à device PS A après son logout.
 *
 * Solution : `BroadcastChannel("diabeo:auth")` partagé entre tous les tabs.
 * Le tab initiateur du logout broadcast `{type: "logout", from: tabId, at}` ;
 * les autres tabs cleanup local (sessionStorage clear + replace `/login`) sans
 * ré-émettre (anti-loop : seul l'initiateur broadcast).
 *
 * **Filtrage `from === ownTabId`** : la spec browser dit que sender ne reçoit
 * pas, mais Node `worker_threads.BroadcastChannel` (jsdom) renvoie au sender.
 * Filtre défensif requis pour portabilité.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useAuth } from "@/hooks/use-auth"
import * as swLifecycleModule from "@/lib/messaging/sw-lifecycle"

// Mock next/navigation router — capture replace + push.
const mockReplace = vi.fn()
const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))

// Mock next-intl translations.
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}))

describe("useAuth — cross-tab logout sync (Issue #450)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  let unregisterSpy: ReturnType<typeof vi.spyOn>

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
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Broadcast émission lors du logout
  // -------------------------------------------------------------------------

  it("logout() broadcast un message {type: 'logout', from, at} après cleanup", async () => {
    // On crée un listener SPY sur un channel distinct (simule "autre tab")
    // monté AVANT le logout. BroadcastChannel jsdom envoie aussi à ses
    // propres listeners — donc le `from` doit être DIFFÉRENT pour qu'on le
    // capture comme "autre tab".
    const otherTabMessages: Array<{ type: string; from: string; at: number }> = []
    const otherTabChannel = new BroadcastChannel("diabeo:auth")
    otherTabChannel.onmessage = (event) => {
      otherTabMessages.push(event.data)
    }

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })

    // Vérifier qu'un message logout a bien été broadcasté.
    await waitFor(() => expect(otherTabMessages.length).toBeGreaterThan(0))
    const msg = otherTabMessages.find((m) => m.type === "logout")
    expect(msg).toBeDefined()
    expect(msg?.from).toBeTypeOf("string")
    expect(msg?.from.length).toBeGreaterThan(0)
    expect(msg?.at).toBeTypeOf("number")
    expect(msg?.at).toBeGreaterThan(0)

    otherTabChannel.close()
  })

  // -------------------------------------------------------------------------
  // Listener cross-tab — autre tab reçoit logout → cleanup local
  // -------------------------------------------------------------------------

  it("tab 2 reçoit broadcast logout d'un autre tab → cleanup local (replace /login + clear sessionStorage)", async () => {
    // Mount du hook "tab 2" → installe listener BroadcastChannel.
    sessionStorage.setItem("diabeo_session_start", "999")
    renderHook(() => useAuth())

    // Simule un broadcast depuis un AUTRE tab (with different `from` id).
    const senderChannel = new BroadcastChannel("diabeo:auth")
    await act(async () => {
      senderChannel.postMessage({
        type: "logout",
        from: "other-tab-id-xyz",
        at: Date.now(),
      })
      // Petite attente pour propagation event loop BroadcastChannel.
      await new Promise((r) => setTimeout(r, 20))
    })

    // Tab 2 doit avoir cleanup local SANS appeler logout() complet
    // (pas de POST /api/auth/logout, pas de DELETE FCM, pas de SW unregister).
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"))
    expect(sessionStorage.getItem("diabeo_session_start")).toBeNull()

    // Critique : pas d'appel logout() complet (pas de side-effect backend).
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(unregisterSpy).not.toHaveBeenCalled()

    senderChannel.close()
  })

  // -------------------------------------------------------------------------
  // Anti-loop : tab initiateur ignore son propre broadcast
  // -------------------------------------------------------------------------

  it("tab initiateur ignore son propre broadcast (anti-loop via from === ownTabId)", async () => {
    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await result.current.logout()
    })

    // logout() complet broadcast + cleanup local — DOIT appeler replace
    // exactement 1 fois (sa propre exécution finally), pas 2 (si listener
    // se déclenchait aussi sur son propre broadcast).
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))
  })

  // -------------------------------------------------------------------------
  // Message non-logout ignoré
  // -------------------------------------------------------------------------

  it("message broadcast non-logout → ignoré (pas de side-effect)", async () => {
    sessionStorage.setItem("diabeo_session_start", "555")
    renderHook(() => useAuth())

    const sender = new BroadcastChannel("diabeo:auth")
    await act(async () => {
      sender.postMessage({ type: "other-event", payload: 42 })
      await new Promise((r) => setTimeout(r, 20))
    })

    // Pas de cleanup local pour message non-logout.
    expect(mockReplace).not.toHaveBeenCalled()
    expect(sessionStorage.getItem("diabeo_session_start")).toBe("555")

    sender.close()
  })

  // -------------------------------------------------------------------------
  // Cleanup channel au unmount
  // -------------------------------------------------------------------------

  it("listener BroadcastChannel close()é au unmount du hook (pas de fuite)", async () => {
    const { unmount } = renderHook(() => useAuth())
    unmount()

    // Après unmount, un broadcast logout d'un autre tab ne doit PLUS
    // déclencher de cleanup (channel closed, listener détaché).
    const sender = new BroadcastChannel("diabeo:auth")
    await act(async () => {
      sender.postMessage({
        type: "logout",
        from: "other-tab-after-unmount",
        at: Date.now(),
      })
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(mockReplace).not.toHaveBeenCalled()
    sender.close()
  })

  // -------------------------------------------------------------------------
  // Graceful fallback : BroadcastChannel non supporté
  // -------------------------------------------------------------------------

  it("BroadcastChannel non supporté → logout fonctionne quand même (graceful fallback)", async () => {
    const originalBC = global.BroadcastChannel
    // @ts-expect-error — simulate absence dans vieux navigateurs.
    delete global.BroadcastChannel

    try {
      const { result } = renderHook(() => useAuth())
      await act(async () => {
        await result.current.logout()
      })

      // Logout local doit fonctionner même sans BroadcastChannel.
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"))
    } finally {
      global.BroadcastChannel = originalBC
    }
  })
})
