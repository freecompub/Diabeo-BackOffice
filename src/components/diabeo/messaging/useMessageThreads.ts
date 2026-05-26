"use client"

/**
 * useMessageThreads — hook GET `/api/messages` polling 60s.
 *
 * US-2076-UI iter 2 — liste threads (inbox) avec polling temps réel pour
 * détecter nouveaux messages reçus / nouvelle conversation.
 *
 * **Contrat backend** (`src/app/api/messages/route.ts` GET) :
 *   - GET — JWT auth + requireGdprConsent (403 `gdprConsentRequired` sinon)
 *   - query `limit` (max 100, default 100) — pagination future iter 4
 *   - response : `{ items: ThreadSummary[] }`
 *   - Cache-Control no-store (PHI deciphered server-side)
 *
 * **Codes erreur normalisés** (whitelist HSA-3 pattern iter 1) :
 *   - `gdprConsentRevoked` (403)
 *   - `networkError`
 *   - `unexpectedError`
 *
 * **Pattern** : cohérent useUnreadCount (iter 1) — mountedRef + inFlightRef
 * + lastFetchAt debounce + fetchSeq pour race out-of-order responses.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { Locale } from "@/i18n/config"

/**
 * ThreadSummary tel qu'exposé par `/api/messages` GET.
 * Mirror de `src/lib/services/messaging.service.ts:543` (interface backend).
 * Décliné côté UI : `createdAt` arrive en string ISO via JSON serialize.
 */
export interface ThreadListItem {
  conversationKey: string
  otherUserId: number
  patientId: number | null
  lastMessage: {
    id: string
    fromUserId: number
    bodyPreview: string
    bodyPreviewTruncated: boolean
    createdAt: string // ISO 8601 (serialized from Date)
    isRead: boolean
  }
  unreadCount: number
}

const DEFAULT_REFRESH_INTERVAL_MS = 60_000

export type MessageThreadsErrorCode = "gdprConsentRevoked" | "networkError" | "unexpectedError"

export interface UseMessageThreadsResult {
  threads: ThreadListItem[]
  /** True uniquement avant le 1er fetch success. */
  isInitialLoading: boolean
  error: MessageThreadsErrorCode | null
  refetch: () => Promise<void>
  /** Timestamp dernière sync — pour afficher "il y a 30s" stale-while-error UX. */
  lastFetchedAt: Date | null
}

export interface UseMessageThreadsParams {
  /** Polling interval ms. Default 60_000. 0 = disabled. */
  refreshInterval?: number
  /** Skip fetching entirely. */
  skip?: boolean
  /** Pagination cap. Default 100 (backend max). */
  limit?: number
}

export function useMessageThreads({
  refreshInterval = DEFAULT_REFRESH_INTERVAL_MS,
  skip = false,
  limit = 100,
}: UseMessageThreadsParams = {}): UseMessageThreadsResult {
  const [threads, setThreads] = useState<ThreadListItem[]>([])
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(!skip)
  const [error, setError] = useState<MessageThreadsErrorCode | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null)
  const mountedRef = useRef(true)
  // Fix H1 pattern hook iter 1 — in-flight guard + lastFetchAt debounce
  // + fetchSeq pour ignorer responses obsolètes.
  const inFlightRef = useRef(false)
  const lastFetchAtRef = useRef(0)
  const fetchSeqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchThreads = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const seq = ++fetchSeqRef.current
    lastFetchAtRef.current = Date.now()
    try {
      const url = `/api/messages?limit=${encodeURIComponent(String(limit))}`
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
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
              setThreads([])
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
      const data = (await res.json()) as { items: ThreadListItem[] }
      if (seq !== fetchSeqRef.current) return
      if (mountedRef.current) {
        setThreads(Array.isArray(data.items) ? data.items : [])
        setError(null)
        setIsInitialLoading(false)
        setLastFetchedAt(new Date())
      }
    } catch (err) {
      if (process.env.NODE_ENV !== "production" && err instanceof Error) {
        console.warn("[useMessageThreads] network error:", err.message)
      }
      if (seq !== fetchSeqRef.current) return
      if (mountedRef.current) {
        setError("networkError")
        setIsInitialLoading(false)
      }
    } finally {
      inFlightRef.current = false
    }
  }, [limit])

  // Initial fetch + polling.
  useEffect(() => {
    if (skip) return
    void fetchThreads()
    if (refreshInterval <= 0) return undefined
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      void fetchThreads()
    }, refreshInterval)
    return () => {
      clearInterval(id)
    }
  }, [skip, refreshInterval, fetchThreads])

  // Refetch immediate quand tab visible (debounced 5s vs tick interval).
  useEffect(() => {
    if (skip) return
    const DEBOUNCE_MS = 5_000
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (Date.now() - lastFetchAtRef.current < DEBOUNCE_MS) return
        void fetchThreads()
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
  }, [skip, fetchThreads])

  return { threads, isInitialLoading, error, refetch: fetchThreads, lastFetchedAt }
}

/**
 * Helper UI : génère un label patient anonymisé "Patient #N" en attendant
 * la résolution du vrai nom (iter 3 — endpoint séparé /api/users/:id
 * filtered HMAC ou cached side-channel).
 *
 * Pas de PHI exposé en clair côté UI tant que iter 3 ne livre pas le
 * mapping userId → name déchiffré + audit READ.
 */
export function getThreadDisplayName(item: ThreadListItem, _locale: Locale): string {
  if (item.patientId !== null) {
    return `Patient #${item.patientId}`
  }
  return `User #${item.otherUserId}`
}

/**
 * Helper UI : initiales pour avatar (P = Patient, U = User staff).
 * Iter 3 remplacera par initiales réelles (P.D. = Pierre Dupont).
 */
export function getThreadAvatarInitials(item: ThreadListItem): string {
  return item.patientId !== null ? "P" : "U"
}
