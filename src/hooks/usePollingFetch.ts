/**
 * Generic polling fetch hook for backoffice dashboard cards.
 *
 * - Initial fetch on mount.
 * - Periodic refresh every `intervalMs` ms (default 30s).
 * - Pause when `document.visibilityState !== "visible"` (battery + perf).
 * - Cleanup on unmount.
 * - Manual refetch via returned `refetch()` callback.
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
  refetch: () => void
}

export function usePollingFetch<T>(
  url: string,
  intervalMs: number = 30_000,
): PollingState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchOnce = useCallback(async (silent: boolean = false) => {
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
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      void fetchOnce(true)
    }, intervalMs)
    return () => {
      clearInterval(id)
      abortRef.current?.abort()
    }
  }, [fetchOnce, intervalMs])

  const refetch = useCallback(() => void fetchOnce(false), [fetchOnce])
  return { data, error, loading, lastUpdatedAt, refetch }
}
