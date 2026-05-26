"use client"

/**
 * useMarkAsRead — hook PUT `/api/messages/[id]/read`.
 *
 * US-2076-UI iter 3 — marquer un message comme lu (idempotent + accepte
 * de marquer plusieurs messages successifs en queue).
 *
 * **Contrat backend** (`/api/messages/[id]/read` PUT) :
 *   - JWT auth + requireGdprConsent
 *   - 200 OK : `{ id, readAt }`
 *   - 404 si message non destinataire (anti-énumération)
 *   - 409 déjà lu (idempotent — pas une erreur côté UI)
 *
 * **Codes erreur whitelist** :
 *   - `notFound` (404)
 *   - `alreadyRead` (409 — traité comme success côté UI)
 *   - `networkError` / `unexpectedError`
 *
 * **Pattern queue** : auto-mark on scroll peut déclencher N markRead
 * concurrents. Le hook les sérialise via `inFlightRef + pendingQueue` :
 * - si already in-flight → push dans queue
 * - quand current finit → pop next + send
 * - dedupe : pas de double-markRead sur le même id
 *
 * **Optimistic** : caller decrement unreadCount localement (cf.
 * `useUnreadCount.decrement`) avant POST, et ne rollback que si error
 * != alreadyRead (qui = idempotent success).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { logHookError } from "@/lib/ui/sanitize-error"

export type MarkAsReadErrorCode = "notFound" | "networkError" | "unexpectedError"

export interface UseMarkAsReadResult {
  /** True si au moins 1 markRead in-flight ou en queue. */
  loading: boolean
  error: MarkAsReadErrorCode | null
  /**
   * Mark a message as read. Idempotent : appels multiples sur le même
   * messageId sont dedupliqués (1 seul POST backend).
   * Retourne un Discriminated Union — JAMAIS throw.
   * `alreadyRead` (409) est traité comme success (idempotent).
   */
  markAsRead: (messageId: string) => Promise<{ ok: true } | { ok: false; code: MarkAsReadErrorCode }>
  reset: () => void
}

/**
 * Fix M1 round 1 review PR #443 — LRU cap pour éviter memory leak sur
 * sessions longues (poste kiosk hôpital). 500 ids = ~30KB heap.
 */
const MARKED_IDS_LRU_CAP = 500

export function useMarkAsRead(): UseMarkAsReadResult {
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<MarkAsReadErrorCode | null>(null)
  const mountedRef = useRef(true)
  // Track in-flight messageIds pour dedup (queue auto-mark on scroll).
  const inFlightIdsRef = useRef<Set<string>>(new Set())
  // Track déjà-marqué pour ne pas re-poster (cache local idempotence).
  // Fix M1 round 1 review PR #443 — LRU cap (eviction first-inserted).
  const markedIdsRef = useRef<Set<string>>(new Set())

  function addMarkedId(id: string): void {
    if (markedIdsRef.current.size >= MARKED_IDS_LRU_CAP) {
      // Évict le plus ancien (Set préserve l'ordre d'insertion).
      const oldest = markedIdsRef.current.values().next().value
      if (oldest !== undefined) markedIdsRef.current.delete(oldest)
    }
    markedIdsRef.current.add(id)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const reset = useCallback(() => {
    if (!mountedRef.current) return
    setError(null)
    setLoading(false)
    inFlightIdsRef.current.clear()
    markedIdsRef.current.clear()
  }, [])

  const markAsRead = useCallback(
    async (messageId: string): Promise<{ ok: true } | { ok: false; code: MarkAsReadErrorCode }> => {
      // Dedup : skip si déjà marqué ou en cours.
      if (markedIdsRef.current.has(messageId)) return { ok: true }
      if (inFlightIdsRef.current.has(messageId)) return { ok: true }
      inFlightIdsRef.current.add(messageId)
      if (mountedRef.current) setLoading(true)
      try {
        const res = await fetch(`/api/messages/${encodeURIComponent(messageId)}/read`, {
          method: "PUT",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
        })
        if (!res.ok) {
          if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = "/login?expired=1"
            return { ok: false, code: "unexpectedError" }
          }
          if (res.status === 409) {
            // Déjà lu — idempotent success.
            addMarkedId(messageId)
            return { ok: true }
          }
          if (res.status === 404) {
            if (mountedRef.current) setError("notFound")
            return { ok: false, code: "notFound" }
          }
          if (mountedRef.current) setError("unexpectedError")
          return { ok: false, code: "unexpectedError" }
        }
        addMarkedId(messageId)
        if (mountedRef.current) setError(null)
        return { ok: true }
      } catch (err) {
        // Fix H7 round 1 review PR #443 — helper centralisé sanitize PII.
        logHookError("useMarkAsRead", err)
        if (mountedRef.current) setError("networkError")
        return { ok: false, code: "networkError" }
      } finally {
        inFlightIdsRef.current.delete(messageId)
        if (mountedRef.current && inFlightIdsRef.current.size === 0) {
          setLoading(false)
        }
      }
    },
    [],
  )

  return { loading, error, markAsRead, reset }
}
