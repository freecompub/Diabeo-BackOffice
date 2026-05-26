"use client"

/**
 * useMessagingPush — FCM consume hook pour US-2076-UI iter 4 (round 1 fixes).
 *
 * Écoute le `BroadcastChannel("messaging-events")` broadcasté par le SW
 * `public/firebase-messaging-sw.js` quand un push `kind: "message_received"`
 * arrive en background.
 *
 * **Feature-flag** : gated par env `NEXT_PUBLIC_FIREBASE_CONFIG` (JSON
 * stringified de la config Firebase). Si absente, hook devient no-op.
 *
 * **Fix HSA M3 round 1 review PR #444** — `updateViaCache: "none"` pour
 * permettre force update SW chez users actifs si bug critique iter 5+.
 *
 * **Fix HSA M2 round 1 review PR #444** — `swRegisteredRef` module-level
 * guard StrictMode double-mount + ref stable singleton (cohérent SW H4
 * BroadcastChannel singleton).
 *
 * **Fix FE H2 round 1 review PR #444** — `onMessageReceivedRef` stable
 * pattern (cohérent ThreadViewer markHookRef iter 3) → effect ne re-run
 * pas à chaque parent render.
 *
 * **Fix HSA M1 round 1 review PR #444** — TODO logout flow doit appeler
 * `unregisterMessagingServiceWorker()` (helper exporté) + DELETE token
 * backend US-2073. Runbook iter 5.
 */

import { useEffect, useRef } from "react"

export interface UseMessagingPushOptions {
  /** Callback appelé à chaque push `kind: "message_received"` reçu. */
  onMessageReceived?: (nonce: string) => void
  /** Skip enregistrement SW (utile tests). */
  skip?: boolean
}

const FEATURE_FLAG_ENV = process.env.NEXT_PUBLIC_FIREBASE_CONFIG

// Fix HSA M2 round 1 review PR #444 — guard module-level singleton SW
// registration (StrictMode double-mount, multi-tab, multi-mount Provider).
// Browser dedupe par scope déjà, mais éliminer le bruit telemetry.
let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null

/**
 * Helper : unregister le SW messaging (logout flow).
 * Fix HSA M1 round 1 review PR #444 — appelé par hook logout pour libérer
 * FCM device + éviter notifications fuites sur poste partagé.
 */
export async function unregisterMessagingServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js")
    if (reg) {
      await reg.unregister()
    }
    swRegistrationPromise = null
  } catch {
    // Silent — logout doit toujours continuer même si SW unregister fail.
  }
}

export function useMessagingPush({ onMessageReceived, skip = false }: UseMessagingPushOptions = {}): {
  isSupported: boolean
  isEnabled: boolean
} {
  // Fix FE H2 round 1 — ref stable, pas de re-effect à chaque parent render.
  const onMessageReceivedRef = useRef(onMessageReceived)
  useEffect(() => {
    onMessageReceivedRef.current = onMessageReceived
  }, [onMessageReceived])

  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "BroadcastChannel" in window
  const isEnabled = Boolean(FEATURE_FLAG_ENV) && isSupported && !skip

  // Register SW + listen BroadcastChannel.
  useEffect(() => {
    if (!isEnabled) return
    let bc: BroadcastChannel | null = null
    let cancelled = false

    const setup = async (): Promise<void> => {
      try {
        // Fix HSA M2 round 1 — singleton registration via module ref.
        // Fix HSA M3 round 1 — `updateViaCache: "none"` permet force
        // update SW si bug critique iter 5+ (sans bump SW_VERSION strict
        // bypass cache 24h max-age default).
        swRegistrationPromise ??= navigator.serviceWorker.register(
          "/firebase-messaging-sw.js",
          { updateViaCache: "none" },
        )
        const reg = await swRegistrationPromise
        if (cancelled || !reg) return

        // Fix HSA C1 round 1 — validation shape config côté CLIENT aussi
        // (defense-in-depth — SW re-valide, mais évite envoi config
        // malformée si env contains erreur saisie).
        const config = FEATURE_FLAG_ENV ? safeParseConfig(FEATURE_FLAG_ENV) : null
        if (config && isValidFirebaseConfig(config) && reg.active) {
          reg.active.postMessage({ type: "FIREBASE_CONFIG", config })
        }

        // Listen broadcast — déclenche callback consumer.
        // Fix StrictMode M2 — guard si bc déjà créé.
        if (bc) return
        bc = new BroadcastChannel("messaging-events")
        bc.onmessage = (event) => {
          const data = event.data as { type?: string; nonce?: string } | null
          if (data?.type === "message_received" && typeof data.nonce === "string") {
            onMessageReceivedRef.current?.(data.nonce)
          }
        }
      } catch (err) {
        // SW registration peut fail (browser support / HTTPS requis prod).
        // Acceptable : polling 30s/60s déjà couvre, FCM = bonus latence.
        if (process.env.NODE_ENV !== "production" && err instanceof Error) {
          console.warn("[useMessagingPush] SW registration failed:", err.message)
        }
      }
    }

    void setup()

    return () => {
      cancelled = true
      if (bc) {
        bc.close()
        bc = null
      }
    }
  }, [isEnabled])

  return { isSupported, isEnabled }
}

/**
 * Fix HSA C1 + L3 round 1 review PR #444 — validation shape config Firebase
 * (apiKey/projectId/messagingSenderId/appId présents et string non-vide).
 */
function isValidFirebaseConfig(config: unknown): config is Record<string, string> {
  if (typeof config !== "object" || config === null) return false
  const c = config as Record<string, unknown>
  const required = ["apiKey", "projectId", "messagingSenderId", "appId"]
  for (const key of required) {
    if (typeof c[key] !== "string" || (c[key] as string).length === 0) return false
  }
  return true
}

function safeParseConfig(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}
