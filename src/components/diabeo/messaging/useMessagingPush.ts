"use client"

/**
 * useMessagingPush — FCM consume hook pour US-2076-UI iter 4.
 *
 * Écoute le `BroadcastChannel("messaging-events")` broadcasté par le SW
 * `public/firebase-messaging-sw.js` quand un push `kind: "message_received"`
 * arrive en background.
 *
 * **Feature-flag** : gated par env `NEXT_PUBLIC_FIREBASE_CONFIG` (JSON
 * stringified de la config Firebase). Si absente, hook devient no-op (pas
 * de SW registration, pas de listener).
 *
 * **Sécurité** :
 *   - Push data-only (pas de PHI lockscreen) — backend `fcm.service.ts`
 *     US-2073 envoie `data: { kind, nonce }` uniquement (HSA déjà validé)
 *   - SW broadcaste `nonce` UNIQUEMENT (pas le bodyPreview)
 *   - Client foreground refresh badge unread + (optionnel) thread courant
 *
 * **Callbacks** :
 *   - `onMessageReceived` : appelé à chaque push reçu (background ou foreground)
 *     → typiquement decrement badge + refetch thread si /messages ouvert
 *
 * **Lifecycle** :
 *   - register SW au mount si feature flag
 *   - listen BroadcastChannel + cleanup au unmount
 *   - foreground messages : `firebase.messaging().onMessage(...)` non géré
 *     ici iter 4 (polling 30s + 60s déjà couvre, FCM = bonus latence)
 */

import { useEffect, useRef } from "react"

export interface UseMessagingPushOptions {
  /** Callback appelé à chaque push `kind: "message_received"` reçu. */
  onMessageReceived?: (nonce: string) => void
  /** Skip enregistrement SW (utile tests). */
  skip?: boolean
}

const FEATURE_FLAG_ENV = process.env.NEXT_PUBLIC_FIREBASE_CONFIG

export function useMessagingPush({ onMessageReceived, skip = false }: UseMessagingPushOptions = {}): {
  isSupported: boolean
  isEnabled: boolean
} {
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
        const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js")
        if (cancelled) return
        // Envoyer la config Firebase au SW via postMessage (évite hardcode
        // dans le fichier SW public).
        const config = FEATURE_FLAG_ENV ? safeParseConfig(FEATURE_FLAG_ENV) : null
        if (config && reg.active) {
          reg.active.postMessage({ type: "FIREBASE_CONFIG", config })
        }

        // Listen broadcast — déclenche callback consumer.
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
