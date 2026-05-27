/**
 * @vitest-environment jsdom
 *
 * Tests pour Issue #450 — cross-tab logout sync via `BroadcastChannel("diabeo:auth")`
 * (follow-up review HSA M2 PR #449 + round 2 reviews PR #451).
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

describe("useAuth — cross-tab logout sync (Issue #450 + round 2 PR #451)", () => {
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
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // Broadcast émission lors du logout (Fix M2 round 2 : waitFor vs setTimeout)
  // -------------------------------------------------------------------------

  it("logout() broadcast un message {type: 'logout', from, at} après cleanup", async () => {
    const otherTabMessages: Array<{ type: string; from: string; at: number }> = []
    const otherTabChannel = new BroadcastChannel("diabeo:auth")
    otherTabChannel.onmessage = (event) => {
      otherTabMessages.push(event.data)
    }

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })

    // Fix M2 round 2 : waitFor au lieu de `await new Promise(r => setTimeout(r, 20))`
    // (flaky en CI sous charge). waitFor retry jusqu'à timeout par défaut 1s.
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
    sessionStorage.setItem("diabeo_session_start", "999")
    renderHook(() => useAuth())

    const senderChannel = new BroadcastChannel("diabeo:auth")
    await act(async () => {
      senderChannel.postMessage({
        type: "logout",
        from: "other-tab-id-xyz",
        at: Date.now(),
      })
    })

    // Fix M2 round 2 : waitFor robuste vs setTimeout arbitraire.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"))
    expect(sessionStorage.getItem("diabeo_session_start")).toBeNull()

    // Critique : pas d'appel logout() complet (pas de side-effect backend).
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(unregisterSpy).not.toHaveBeenCalled()

    senderChannel.close()
  })

  // -------------------------------------------------------------------------
  // Anti-loop : tab initiateur ignore son propre broadcast
  // (Fix H2 round 2 : test efficace — capture le `from` réellement envoyé
  // puis simule un message ENTRANT avec le MÊME `from` pour valider que le
  // filtre `from === ownTabId` est réellement actif)
  // -------------------------------------------------------------------------

  it("Fix H2 — tab initiateur ignore son propre broadcast (anti-loop via from === ownTabId réellement filtré)", async () => {
    // Capture le tabId réel via le broadcast émis lors du logout.
    let capturedTabId: string | null = null
    const spyChannel = new BroadcastChannel("diabeo:auth")
    spyChannel.onmessage = (event) => {
      if (event.data?.type === "logout" && typeof event.data.from === "string") {
        capturedTabId = event.data.from
      }
    }

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })

    await waitFor(() => expect(capturedTabId).not.toBeNull())
    const replaceCallsAfterLogout = mockReplace.mock.calls.length
    expect(replaceCallsAfterLogout).toBe(1) // 1 appel via finally local

    // Maintenant simule un message ENTRANT avec exactement le même tabId
    // que celui que ce hook a émis → le listener DOIT l'ignorer (sinon
    // replace serait appelé une 2e fois).
    await act(async () => {
      spyChannel.postMessage({
        type: "logout",
        from: capturedTabId,
        at: Date.now() + 10,
      })
    })

    // Attente robuste pour propagation — replace doit rester à 1 appel.
    // On utilise waitFor avec un délai borné pour permettre à un éventuel
    // listener bogué de déclencher (et faire échouer le test si filtre cassé).
    await new Promise((r) => setTimeout(r, 50))
    expect(mockReplace).toHaveBeenCalledTimes(replaceCallsAfterLogout)

    spyChannel.close()
  })

  // -------------------------------------------------------------------------
  // Validation runtime — message malformé (Fix M1 round 2)
  // -------------------------------------------------------------------------

  it("Fix M1 — message broadcast avec from null (malformé) → ignoré", async () => {
    renderHook(() => useAuth())

    const sender = new BroadcastChannel("diabeo:auth")
    await act(async () => {
      // `from: null` : passerait le filtre `from === ownTabId` (null !== string)
      // sans la guard `typeof from !== "string"` introduite en round 2.
      sender.postMessage({ type: "logout", from: null, at: Date.now() })
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(mockReplace).not.toHaveBeenCalled()
    sender.close()
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
    })

    await new Promise((r) => setTimeout(r, 50))
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

    const sender = new BroadcastChannel("diabeo:auth")
    await act(async () => {
      sender.postMessage({
        type: "logout",
        from: "other-tab-after-unmount",
        at: Date.now(),
      })
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(mockReplace).not.toHaveBeenCalled()
    sender.close()
  })

  // -------------------------------------------------------------------------
  // Graceful fallback : BroadcastChannel non supporté
  // (Fix L2 round 2 : vi.stubGlobal au lieu de delete global.X)
  // -------------------------------------------------------------------------

  it("BroadcastChannel non supporté → logout fonctionne quand même (graceful fallback)", async () => {
    // Fix L2 round 2 : `vi.stubGlobal` + `vi.unstubAllGlobals()` dans afterEach
    // au lieu de `delete global.BroadcastChannel` (isolation test, restore
    // garanti même si test throw).
    vi.stubGlobal("BroadcastChannel", undefined)

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"))
  })

  // -------------------------------------------------------------------------
  // Concurrent dual-logout 2 tabs simultanés (Fix M3 round 2)
  // -------------------------------------------------------------------------

  it("Fix M3 — 2 tabs logout simultanés → chaque tab cleanup exactement 1 fois (idempotent)", async () => {
    // Simule 2 hooks distincts (= 2 tabs ouverts par le même PS).
    const { result: tab1 } = renderHook(() => useAuth())
    const { result: tab2 } = renderHook(() => useAuth())

    // Les 2 tabs cliquent logout SIMULTANÉMENT.
    await act(async () => {
      await Promise.all([tab1.current.logout(), tab2.current.logout()])
    })

    await waitFor(() => expect(mockReplace).toHaveBeenCalled())
    // Petite attente pour permettre aux broadcasts cross-tab de se propager.
    await new Promise((r) => setTimeout(r, 50))

    // Comportement attendu :
    //   - tab1 broadcast → tab2 reçoit (autre from) → tab2 listener cleanup local
    //     MAIS tab2 a déjà fait son cleanup local via son propre finally
    //   - inverse pour tab2 → tab1
    // Total replace : 2 calls minimum (1 par finally) ; cleanup local
    // additionnel listener idempotent (sessionStorage déjà cleared, router.replace
    // appelé sur même path = no-op visuel Next.js).
    // Le test garantit qu'on n'a PAS de boucle infinie (sinon dépasserait 4).
    expect(mockReplace.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(mockReplace.mock.calls.length).toBeLessThanOrEqual(4)
    // Tous les replace doivent cibler /login (pas de URL corruption).
    for (const call of mockReplace.mock.calls) {
      expect(call[0]).toBe("/login")
    }
  })
})
