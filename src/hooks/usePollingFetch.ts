/**
 * Generic polling fetch hook for backoffice dashboard cards.
 *
 *  - Initial fetch on mount.
 *  - Periodic refresh every `intervalMs` ms (default 30s).
 *  - **visibilitychange** listener clears the interval when the tab is
 *    hidden (avoids 960 wakeups/8h idle ; code-review H4).
 *  - Cleanup on unmount.
 *  - Manual refetch via returned `refetch()` callback.
 *  - **Auth termination** : on HTTP 401, stop the interval permanently
 *    and trigger a single `window.location` redirect to `/login`
 *    (healthcare L3 — avoid pounding `/api/**` after JWT expiry).
 *  - **Staleness signal** : `isStale=true` when last successful fetch is
 *    older than 2× `intervalMs` (code-review C1 — surface silent polling
 *    failures so the UI can display "données obsolètes").
 *
 * Errors don't replace prior data ; they live in `error` while last good
 * data stays in `data` (so cards don't flicker empty on transient 5xx).
 */

"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type PollingState<T> = {
  data: T | null
  error: string | null
  loading: boolean
  /** ms since UNIX epoch of last successful fetch. null until first success. */
  lastUpdatedAt: number | null
  /** True when last successful fetch is older than 2× intervalMs. */
  isStale: boolean
  refetch: () => void
}

const STALE_FACTOR = 2

export function usePollingFetch<T>(
  url: string,
  intervalMs: number = 30_000,
): PollingState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stoppedRef = useRef<boolean>(false)

  const fetchOnce = useCallback(async (silent: boolean = false) => {
    if (stoppedRef.current) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (!silent) setLoading(true)
    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: { "X-Requested-With": "fetch" },
        signal: controller.signal,
      })
      if (res.status === 401) {
        // healthcare L3 — JWT expired ; stop polling and bounce to login.
        stoppedRef.current = true
        if (typeof window !== "undefined") window.location.href = "/login"
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as T
      setData(json)
      setLastUpdatedAt(Date.now())
      setError(null)
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return
      setError(e instanceof Error ? e.message : "fetchFailed")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [url])

  useEffect(() => {
    void fetchOnce(false)
    let intervalId: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (intervalId !== null || stoppedRef.current) return
      intervalId = setInterval(() => void fetchOnce(true), intervalMs)
    }
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
    const onVisibility = () => {
      if (typeof document === "undefined") return
      if (document.visibilityState === "visible") {
        // Catch up immediately when tab regains focus.
        void fetchOnce(true)
        start()
      } else {
        stop()
      }
    }
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      start()
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility)
    }
    return () => {
      stop()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility)
      }
      abortRef.current?.abort()
    }
  }, [fetchOnce, intervalMs])

  const refetch = useCallback(() => void fetchOnce(false), [fetchOnce])
  const isStale = lastUpdatedAt !== null
    && Date.now() - lastUpdatedAt > STALE_FACTOR * intervalMs
  return { data, error, loading, lastUpdatedAt, isStale, refetch }
}
