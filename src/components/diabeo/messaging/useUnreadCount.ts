"use client"

/**
 * useUnreadCount — hook GET `/api/messages/unread-count` polling 60s.
 *
 * US-2076-UI iter 1 (foundation) — badge sidebar messagerie + cohérence
 * cross-page (le hook est utilisé par `NavigationShell` SidebarNav badge
 * + par la page `/messages` pour décrémenter optimistic post-read).
 *
 * **Contrat backend** (`src/app/api/messages/unread-count/route.ts`) :
 *   - GET — JWT auth + requireGdprConsent (403 `gdprConsentRequired` sinon)
 *   - response : `{ count: number }`
 *   - Cache-Control no-store (badge temps réel)
 *
 * **Codes erreur normalisés** (whitelist HSA-3 pattern iter 5 RDV) :
 *   - `gdprConsentRevoked` (403)
 *   - `networkError`
 *   - `unexpectedError`
 *
 * **Pattern** : cohérent useAppointments — mountedRef cleanup + polling
 * via setInterval + pause sur tab hidden (visibilitychange).
 */

import { useCallback, useEffect, useRef, useState } from "react"

const DEFAULT_REFRESH_INTERVAL_MS = 60_000

/**
 * Fix H8 round 1 review PR #440 — DoS amplification note.
 *
 * Le hook est consommé via `<UnreadCountProvider>` UNIQUEMENT depuis
 * `NavigationShell` (= toutes les pages dashboard). Le Provider passe
 * `skip={!hasBadgeItem}` pour ne pas fire de fetch si l'utilisateur n'a
 * AUCUN item nav avec `showUnreadBadge` (ex: variant patient ou role qui
 * n'a pas accès `/messages`).
 *
 * En pratique : seuls NURSE+ déclenchent le polling. Backend `/api/messages/
 * unread-count` doit néanmoins avoir un rate-limit par user (vérifier
 * `src/lib/services/messaging.service.ts` `checkAndRecordSendRate` étendu
 * au `unreadCount` ou un middleware dédié).
 *
 * Polling 60s × N NURSE+ connectés simultanés = charge constante. Acceptable
 * MVP. Long terme : migration SSE / WebSocket scope B (US-2076bis V2).
 */

export type UnreadCountErrorCode = "gdprConsentRevoked" | "networkError" | "unexpectedError"

export interface UseUnreadCountResult {
  count: number
  /** True uniquement avant le 1er fetch success. */
  isInitialLoading: boolean
  error: UnreadCountErrorCode | null
  refetch: () => Promise<void>
  /** Decrement optimistic local (post-markRead avant revalidation). */
  decrement: (by?: number) => void
}

export interface UseUnreadCountParams {
  /** Polling interval ms. Default 60_000. 0 = disabled. */
  refreshInterval?: number
  /** Skip fetching entirely (ex: user pas authentifié encore). */
  skip?: boolean
}

export function useUnreadCount({
  refreshInterval = DEFAULT_REFRESH_INTERVAL_MS,
  skip = false,
}: UseUnreadCountParams = {}): UseUnreadCountResult {
  const [count, setCount] = useState<number>(0)
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(!skip)
  const [error, setError] = useState<UnreadCountErrorCode | null>(null)
  const mountedRef = useRef(true)
  // Fix H1 round 1 review PR #440 — in-flight guard + lastFetchAt debounce.
  // Évite race fetch double quand tab hidden→visible juste avant un tick
  // setInterval (visibilitychange + tick déclenchent 2 fetchs < 1s).
  const inFlightRef = useRef(false)
  const lastFetchAtRef = useRef(0)
  // Fix M5 round 1 review PR #440 — pendingOptimisticDelta : compense les
  // decrements optimistic locaux pendant qu'un fetch en cours peut
  // retourner un count pré-markRead (latence backend cache).
  const pendingOptimisticDeltaRef = useRef(0)
  // Fix CR M4 round 1 review PR #440 — fetchSeq pour ignorer setCount des
  // fetchs obsolètes (race condition out-of-order responses).
  const fetchSeqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchCount = useCallback(async (): Promise<void> => {
    // Fix H1 round 1 — guard in-flight (1 fetch simultané max).
    if (inFlightRef.current) return
    inFlightRef.current = true
    const seq = ++fetchSeqRef.current
    lastFetchAtRef.current = Date.now()
    try {
      const res = await fetch("/api/messages/unread-count", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
      // Skip setCount si ce fetch est obsolète (newer fetch parti entretemps).
      if (seq !== fetchSeqRef.current) return
      if (!res.ok) {
        if (res.status === 401 && typeof window !== "undefined") {
          window.location.href = "/login?expired=1"
          return
        }
        if (res.status === 403) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          if (body.error === "gdprConsentRequired") {
            if (mountedRef.current) {
              setError("gdprConsentRevoked")
              setCount(0)
              setIsInitialLoading(false)
            }
            return
          }
        }
        if (mountedRef.current) {
          setError("unexpectedError")
          setIsInitialLoading(false)
        }
        return
      }
      const data = (await res.json()) as { count: number }
      if (seq !== fetchSeqRef.current) return
      if (mountedRef.current) {
        const rawCount = typeof data.count === "number" && data.count >= 0 ? data.count : 0
        // Fix M5 round 1 — soustraire le pendingOptimisticDelta (decrement
        // local appliqué pendant que le fetch était en vol). Si markRead
        // côté serveur a déjà été propagé, rawCount sera déjà réduit →
        // delta clamp à 0 max. Reset delta après application.
        const adjustedCount = Math.max(0, rawCount - pendingOptimisticDeltaRef.current)
        pendingOptimisticDeltaRef.current = 0
        setCount(adjustedCount)
        setError(null)
        setIsInitialLoading(false)
      }
    } catch (err) {
      // Fix CR L8 round 1 — pas d'AbortController utilisé donc le check
      // err.name !== "AbortError" est dead code. Retiré.
      if (process.env.NODE_ENV !== "production" && err instanceof Error) {
        console.warn("[useUnreadCount] network error:", err.message)
      }
      if (seq !== fetchSeqRef.current) return
      if (mountedRef.current) {
        setError("networkError")
        setIsInitialLoading(false)
      }
    } finally {
      inFlightRef.current = false
    }
  }, [])

  const decrement = useCallback((by: number = 1) => {
    if (!mountedRef.current) return
    // Fix M5 round 1 — tracker delta pour compenser fetch en cours.
    pendingOptimisticDeltaRef.current += by
    setCount((prev) => Math.max(0, prev - by))
  }, [])

  // Initial fetch + polling. Fix H2 round 1 — retirer queueMicrotask
  // injustifié (fetchCount est async, setState est déjà déféré post-await).
  // Pattern aligné useAppointments (`start/stop` fonctionnel direct).
  useEffect(() => {
    if (skip) return
    void fetchCount()
    if (refreshInterval <= 0) return undefined
    const id = setInterval(() => {
      // Pause polling si tab hidden — économise quotas backend + batterie mobile.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      void fetchCount()
    }, refreshInterval)
    return () => {
      clearInterval(id)
    }
  }, [skip, refreshInterval, fetchCount])

  // Refetch immediate quand tab revient visible (debounced 5s pour éviter
  // race avec tick setInterval qui pourrait tomber < 100ms après).
  useEffect(() => {
    if (skip) return
    const DEBOUNCE_MS = 5_000
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        // Skip si fetch < 5s (cohérence avec interval pacing).
        if (Date.now() - lastFetchAtRef.current < DEBOUNCE_MS) return
        void fetchCount()
      }
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible)
    }
    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible)
      }
    }
  }, [skip, fetchCount])

  return { count, isInitialLoading, error, refetch: fetchCount, decrement }
}
