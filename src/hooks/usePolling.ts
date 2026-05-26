"use client"

/**
 * usePolling — helper hook factor (Fix M8 round 1 review PR #441).
 *
 * Factorise le pattern polling 60s + pause tab hidden + visibilitychange
 * refetch debounced + cleanup correctement, partagé entre `useUnreadCount`
 * (iter 1) et `useMessageThreads` (iter 2). Iter 3 (`useThreadMessages`) +
 * iter 4 (`useTypingPresence` futur) réutiliseront ce helper.
 *
 * **Caractéristiques** :
 *   - Initial fetch au mount (trigger `"user"`)
 *   - Polling `setInterval(intervalMs)` avec pause si `document.visibilityState`
 *     `=== "hidden"` (économise quota backend + batterie mobile)
 *   - `visibilitychange` refetch immédiat avec debounce 5s vs dernier succès
 *   - `skip` désactive tout (utile gating role / Provider absent)
 *
 * **Type contract** :
 *   - `fetcher(trigger)` retourne `Promise<void>` — fetcher gère son propre
 *     state (loading/error/data) ; ce hook gère uniquement le **scheduling**.
 *   - Le caller doit fournir un fetcher stable via `useCallback` pour éviter
 *     restart du polling à chaque render.
 *
 * **Pattern d'usage** :
 * ```ts
 * const fetcher = useCallback(async (trigger: PollingTrigger) => {
 *   // ... fetch logic + setState
 * }, [deps])
 * usePolling(fetcher, { intervalMs: 60_000, skip })
 * ```
 *
 * Pas de in-flight guard ici : c'est au fetcher de gérer ses propres
 * guards (cohérent avec pattern useUnreadCount/useMessageThreads existants
 * — `inFlightRef` + `fetchSeqRef` restent locaux au fetcher).
 */

import { useEffect, useRef } from "react"

export type PollingTrigger = "user" | "poll" | "visibilitychange"

export interface UsePollingOptions {
  /** Polling interval ms. Default 60_000. 0 = disabled (initial fetch only). */
  intervalMs?: number
  /** Skip tout : pas d'initial fetch, pas de polling, pas de listener. */
  skip?: boolean
  /** Debounce visibilitychange refetch vs dernier succès. Default 5_000ms. */
  debounceVisibilityMs?: number
}

/**
 * Schedule initial fetch + polling + visibilitychange refetch.
 *
 * @param fetcher Function called with `trigger` param. Must be stable via
 *   useCallback to avoid restart cycles.
 * @param markSuccess Optional callback fired AFTER a successful fetch (used
 *   by debounce visibilitychange). Si non fourni, debounce désactivé.
 */
export function usePolling(
  fetcher: (trigger: PollingTrigger) => Promise<void> | void,
  options: UsePollingOptions = {},
): { lastSuccessAtRef: React.MutableRefObject<number> } {
  const {
    intervalMs = 60_000,
    skip = false,
    debounceVisibilityMs = 5_000,
  } = options

  const lastSuccessAtRef = useRef<number>(0)
  const fetcherRef = useRef(fetcher)
  // Update fetcherRef dans useEffect (pas during render — React-hooks rule).
  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  // Initial fetch + polling.
  useEffect(() => {
    if (skip) return
    void fetcherRef.current("user")
    if (intervalMs <= 0) return undefined
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      void fetcherRef.current("poll")
    }, intervalMs)
    return () => {
      clearInterval(id)
    }
  }, [skip, intervalMs])

  // Refetch immediate quand tab visible (debounced).
  useEffect(() => {
    if (skip) return
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (Date.now() - lastSuccessAtRef.current < debounceVisibilityMs) return
        void fetcherRef.current("visibilitychange")
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
  }, [skip, debounceVisibilityMs])

  return { lastSuccessAtRef }
}
