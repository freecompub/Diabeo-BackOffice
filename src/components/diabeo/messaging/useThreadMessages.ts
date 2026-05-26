"use client"

/**
 * useThreadMessages — hook GET `/api/messages/thread/[conversationKey]`.
 *
 * US-2076-UI iter 3 — fetch les messages d'un thread spécifique avec
 * cursor pagination (50 messages/page backend) + polling 30s pour détecter
 * nouveaux messages reçus dans le thread courant ouvert.
 *
 * **Contrat backend** (`/api/messages/thread/[conversationKey]` GET) :
 *   - JWT auth + requireGdprConsent
 *   - paramsSchema : conversationKey hex 64char
 *   - querySchema : cursor (opt) + limit (default 50, max 50)
 *   - response : `{ items: ThreadMessage[], nextCursor: string | null }`
 *   - 404 si conversationKey non-participant (anti-énumération)
 *   - Cache-Control no-store
 *
 * **Codes erreur whitelist HSA-3 pattern** :
 *   - `gdprConsentRevoked` (403)
 *   - `notFound` (404) — conversationKey invalide ou pas participant
 *   - `networkError`
 *   - `unexpectedError`
 *
 * **Pattern** : cohérent useMessageThreads iter 2 + usePolling helper iter
 * 2 PR #441 — mountedRef + inFlightRef + fetchSeq + debounce.
 *
 * **Loadmore** : `loadMore()` charge la page suivante via `nextCursor`
 * (infinite scroll vers le HAUT — messages anciens). Polling 30s ne charge
 * que la PREMIÈRE page (nouveaux messages récents).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { usePolling, type PollingTrigger } from "@/hooks/usePolling"
import { logHookError } from "@/lib/ui/sanitize-error"

/**
 * ThreadMessage tel qu'exposé par `/api/messages/thread/[key]` GET.
 * Mirror de `src/lib/services/messaging.service.ts:560` (interface backend).
 */
export interface ThreadMessageItem {
  id: string
  fromUserId: number
  toUserId: number
  body: string
  createdAt: string // ISO 8601
  readAt: string | null
}

const DEFAULT_REFRESH_INTERVAL_MS = 30_000 // 30s (plus rapide que threads list 60s)
const DEFAULT_PAGE_LIMIT = 50

export type ThreadMessagesErrorCode = "gdprConsentRevoked" | "notFound" | "networkError" | "unexpectedError"

export interface UseThreadMessagesResult {
  messages: ThreadMessageItem[]
  /** True uniquement avant le 1er fetch success. */
  isInitialLoading: boolean
  /** True pendant un loadMore() (chargement messages anciens). */
  isLoadingMore: boolean
  error: ThreadMessagesErrorCode | null
  /** Cursor pour page suivante (null si end-of-thread). */
  nextCursor: string | null
  /** Refetch first page (post-send message, polling, post-markRead). */
  refetch: () => Promise<void>
  /** Charge la page suivante (infinite scroll vers le haut). */
  loadMore: () => Promise<void>
  lastFetchedAt: Date | null
}

export interface UseThreadMessagesParams {
  /** ConversationKey (hex 64char) du thread à fetcher. null = skip. */
  conversationKey: string | null
  /** Polling interval ms. Default 30_000. 0 = disabled. */
  refreshInterval?: number
  /** Page limit. Default 50 (backend max). */
  limit?: number
}

export function useThreadMessages({
  conversationKey,
  refreshInterval = DEFAULT_REFRESH_INTERVAL_MS,
  limit = DEFAULT_PAGE_LIMIT,
}: UseThreadMessagesParams): UseThreadMessagesResult {
  const skip = conversationKey === null
  const [messages, setMessages] = useState<ThreadMessageItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(!skip)
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false)
  const [error, setError] = useState<ThreadMessagesErrorCode | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null)
  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)
  const fetchSeqRef = useRef(0)
  // Track current conversationKey pour reset state si change.
  const currentKeyRef = useRef<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Reset state quand conversationKey change.
  useEffect(() => {
    if (conversationKey !== currentKeyRef.current) {
      currentKeyRef.current = conversationKey
      setMessages([])
      setNextCursor(null)
      setIsInitialLoading(!skip)
      setIsLoadingMore(false)
      setError(null)
      setLastFetchedAt(null)
    }
  }, [conversationKey, skip])

  const fetchPage = useCallback(
    async (cursor: string | null, trigger: PollingTrigger): Promise<void> => {
      if (!conversationKey) return
      if (inFlightRef.current) return
      inFlightRef.current = true
      const seq = ++fetchSeqRef.current
      const isLoadMore = cursor !== null
      if (isLoadMore && mountedRef.current) setIsLoadingMore(true)
      try {
        const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 50
        const params = new URLSearchParams({ limit: String(safeLimit) })
        if (cursor) params.set("cursor", cursor)
        const url = `/api/messages/thread/${encodeURIComponent(conversationKey)}?${params.toString()}`
        const res = await fetch(url, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "X-Thread-Trigger": trigger,
          },
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
                setMessages([])
                setIsInitialLoading(false)
              }
              return
            }
          }
          if (res.status === 404) {
            if (mountedRef.current) {
              setError("notFound")
              setMessages([])
              setIsInitialLoading(false)
            }
            return
          }
          if (mountedRef.current) {
            setError("unexpectedError")
            setIsInitialLoading(false)
          }
          return
        }
        const data = (await res.json()) as {
          items: ThreadMessageItem[]
          nextCursor: string | null
        }
        if (seq !== fetchSeqRef.current) return
        if (mountedRef.current) {
          const newItems = Array.isArray(data.items) ? data.items : []
          if (isLoadMore) {
            // LoadMore : append (messages anciens en queue, ordre conservé).
            setMessages((prev) => [...prev, ...newItems])
          } else {
            // Initial / refetch / poll : replace first page.
            setMessages(newItems)
          }
          setNextCursor(typeof data.nextCursor === "string" ? data.nextCursor : null)
          setError(null)
          setIsInitialLoading(false)
          setLastFetchedAt(new Date())
        }
      } catch (err) {
        // Fix H7 round 1 review PR #443 — helper centralisé sanitize PII.
        logHookError("useThreadMessages", err)
        if (seq !== fetchSeqRef.current) return
        if (mountedRef.current) {
          setError("networkError")
          setIsInitialLoading(false)
        }
      } finally {
        inFlightRef.current = false
        if (mountedRef.current) setIsLoadingMore(false)
      }
    },
    [conversationKey, limit],
  )

  // Polling/initial fetch — première page uniquement (pas loadMore).
  const pollFetcher = useCallback(
    async (trigger: PollingTrigger): Promise<void> => {
      await fetchPage(null, trigger)
    },
    [fetchPage],
  )

  const { lastSuccessAtRef } = usePolling(pollFetcher, {
    intervalMs: refreshInterval,
    skip,
  })

  // Sync lastSuccessAtRef post-success (cohérent useMessageThreads).
  useEffect(() => {
    if (lastFetchedAt) {
      lastSuccessAtRef.current = lastFetchedAt.getTime()
    }
  }, [lastFetchedAt, lastSuccessAtRef])

  const refetch = useCallback(async (): Promise<void> => {
    await fetchPage(null, "user")
  }, [fetchPage])

  const loadMore = useCallback(async (): Promise<void> => {
    if (!nextCursor || isLoadingMore) return
    await fetchPage(nextCursor, "user")
  }, [fetchPage, nextCursor, isLoadingMore])

  return {
    messages,
    isInitialLoading,
    isLoadingMore,
    error,
    nextCursor,
    refetch,
    loadMore,
    lastFetchedAt,
  }
}
