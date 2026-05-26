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

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchCount = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/messages/unread-count", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
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
      if (mountedRef.current) {
        setCount(typeof data.count === "number" && data.count >= 0 ? data.count : 0)
        setError(null)
        setIsInitialLoading(false)
      }
    } catch (err) {
      if (process.env.NODE_ENV !== "production" && err instanceof Error && err.name !== "AbortError") {
        console.warn("[useUnreadCount] network error:", err.message)
      }
      if (mountedRef.current) {
        setError("networkError")
        setIsInitialLoading(false)
      }
    }
  }, [])

  const decrement = useCallback((by: number = 1) => {
    if (!mountedRef.current) return
    setCount((prev) => Math.max(0, prev - by))
  }, [])

  // Initial fetch + polling. Pattern cohérent useAppointments :
  // wrap setInterval pour éviter `react-hooks/set-state-in-effect` —
  // l'initial fetch est planifié via queueMicrotask (sort du body sync).
  useEffect(() => {
    if (skip) return
    let cancelled = false
    const runInitial = () => {
      if (!cancelled) void fetchCount()
    }
    queueMicrotask(runInitial)
    if (refreshInterval <= 0) {
      return () => {
        cancelled = true
      }
    }
    const id = setInterval(() => {
      // Pause polling si tab hidden — économise quotas backend + batterie mobile.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      void fetchCount()
    }, refreshInterval)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [skip, refreshInterval, fetchCount])

  // Refetch immediate quand tab revient visible (latence acceptable < 1s).
  useEffect(() => {
    if (skip) return
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
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
