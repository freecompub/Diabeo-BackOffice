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
import { usePolling, type PollingTrigger } from "@/hooks/usePolling"

/**
 * ThreadSummary tel qu'exposé par `/api/messages` GET.
 * Mirror de `src/lib/services/messaging.service.ts:543` (interface backend).
 * Décliné côté UI : `createdAt` arrive en string ISO via JSON serialize.
 */
export interface ThreadListItem {
  conversationKey: string
  otherUserId: number
  /**
   * US-2076bis-V2 (Issue #442) — UUID v4 opaque (remplace `patientId` BDD
   * séquentiel iter 2). Élimine timing oracle énumération ANSSI / RGPD
   * Art. 5.1.f. `null` si message coordination staff pure ou patient
   * soft-deleted. UI affiche les 8 premiers chars (= ~32 bits entropy,
   * suffisant pour avatars uniques).
   */
  patientPublicRef: string | null
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

type InboxTrigger = PollingTrigger

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
  // Pattern hook iter 1 — in-flight guard + fetchSeq pour ignorer responses
  // obsolètes (race out-of-order). lastSuccessAtRef est fourni par usePolling
  // helper (Fix M8 round 1 PR #441 factor).
  const inFlightRef = useRef(false)
  const fetchSeqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchThreads = useCallback(async (trigger: InboxTrigger = "user"): Promise<void> => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const seq = ++fetchSeqRef.current
    try {
      // Fix H2 round 1 review PR #441 — `limit` NaN-safe (defense-in-depth :
      // signature publique du hook expose `limit` libre, un consumer peut
      // passer NaN/Infinity/string parseInt-cast → URL `?limit=NaN` →
      // backend Zod 400 → boucle `unexpectedError` toutes les 60s).
      const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 100
      const url = `/api/messages?limit=${encodeURIComponent(String(safeLimit))}`
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          // Fix H1 round 1 review PR #441 — discriminator audit polling.
          "X-Inbox-Trigger": trigger,
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
              setThreads([])
              setIsInitialLoading(false)
            }
            return
          }
        }
        if (mountedRef.current) {
          // Fix H4 round 1 review PR #441 — stale-while-error : ne PAS
          // vider `threads` sur 500 si on a déjà eu un succès (l'UI peut
          // afficher un bandeau "Synchronisation interrompue" en
          // overlay). `setThreads` NON appelé → preserve l'ancien array.
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
        // Fix H6 + M8 round 1 review PR #441 — lastSuccessAtRef est managé
        // par usePolling helper (synced via useEffect [lastFetchedAt]).
      }
    } catch (err) {
      if (process.env.NODE_ENV !== "production" && err instanceof Error) {
        console.warn("[useMessageThreads] network error:", err.message)
      }
      if (seq !== fetchSeqRef.current) return
      if (mountedRef.current) {
        // Fix H4 round 1 review PR #441 — stale-while-error idem 500.
        setError("networkError")
        setIsInitialLoading(false)
      }
    } finally {
      inFlightRef.current = false
    }
  }, [limit])

  // Refetch public (sans paramètre trigger — défault "user" pour appels
  // manuels comme `refetch()` post-markRead). Le polling interne utilise
  // directement `fetchThreads("poll")` / `fetchThreads("visibilitychange")`.
  const refetch = useCallback(async (): Promise<void> => {
    await fetchThreads("user")
  }, [fetchThreads])

  // Fix M8 round 1 review PR #441 — factor polling lifecycle dans
  // `usePolling` helper réutilisable iter 3/4. Le helper expose
  // `lastSuccessAtRef` que le fetcher update post-commit success
  // (pour debounce visibilitychange).
  const { lastSuccessAtRef } = usePolling(fetchThreads, {
    intervalMs: refreshInterval,
    skip,
  })

  // Update lastSuccessAtRef après commit success (le helper le lit pour
  // debouncer visibilitychange). Wrap fetchThreads via useEffect-like ?
  // Plus simple : on lit lastSuccessAtRef.current directement dans fetch
  // setState block via closure stable.
  // Pour éviter ce couplage, on update inline dans le fetcher principal :
  useEffect(() => {
    // Mark lastSuccess via lastFetchedAt sync — chaque setLastFetchedAt
    // est suivi de l'update ref pour le debounce.
    if (lastFetchedAt) {
      lastSuccessAtRef.current = lastFetchedAt.getTime()
    }
  }, [lastFetchedAt, lastSuccessAtRef])

  return { threads, isInitialLoading, error, refetch, lastFetchedAt }
}

/**
 * Helper UI : génère un label patient anonymisé "Patient #N" en attendant
 * la résolution du vrai nom (iter 3 — endpoint séparé /api/users/:id
 * filtered HMAC ou cached side-channel).
 *
 * Pas de PHI exposé en clair côté UI tant que iter 3 ne livre pas le
 * mapping userId → name déchiffré + audit READ.
 *
 * Fix M6 round 1 review PR #441 — `_locale` param retiré (YAGNI). Iter 3
 * réintroduira si nécessaire pour formater "Mme/M. Patient" localisé.
 */
export function getThreadDisplayName(item: ThreadListItem): string {
  if (item.patientPublicRef !== null) {
    // US-2076bis-V2 (Issue #442) — 8 premiers chars du UUID v4 = ~32 bits
    // entropy = ~4 milliards de valeurs distinctes (suffisant avatars
    // uniques) sans révéler l'UUID complet (defense-in-depth).
    return `Patient #${item.patientPublicRef.slice(0, 8)}`
  }
  return `User #${item.otherUserId}`
}

/**
 * Helper UI : initiales pour avatar (P = Patient, U = User staff).
 * Iter 3 remplacera par initiales réelles (P.D. = Pierre Dupont).
 */
export function getThreadAvatarInitials(item: ThreadListItem): string {
  return item.patientPublicRef !== null ? "P" : "U"
}
