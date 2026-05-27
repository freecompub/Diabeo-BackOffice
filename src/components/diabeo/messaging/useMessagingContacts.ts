"use client"

/**
 * useMessagingContacts — hook GET `/api/messaging/contacts`.
 *
 * Fix HSA H2 + CR/FE round 1 review PR #444 — endpoint dédié filtré par
 * `canMessage` côté backend (anti fuite Art. 7 préférence patient).
 *
 * Avant : `/api/patients` retournait TOUS les patients du PS (NURSE+),
 * dont ceux qui avaient révoqué le consent messagerie → click → POST
 * `/api/messages` → 403 forbidden → confusion + inférence opt-out.
 *
 * Backend `/api/messaging/contacts` route appelle `canMessage()` server-side
 * et retourne uniquement les contacts réellement messageables.
 *
 * **Anonymisation iter 4** : `Patient #N` cohérent ThreadList iter 2.
 * Vraie résolution nom future (Issue #442 UUID opaques).
 *
 * **Codes erreur HSA-3** :
 *   - `gdprConsentRevoked` (403 gdprConsentRequired)
 *   - `forbidden` (403 RBAC)
 *   - `networkError`
 *   - `unexpectedError`
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { logHookError } from "@/lib/ui/sanitize-error"

/**
 * Contact tel qu'utilisé par NewThreadModal.
 * Subset de `Patient` backend — uniquement les champs nécessaires.
 * `userId` est obligatoire (= toUserId pour POST /api/messages).
 */
export interface MessagingContact {
  patientId: number
  userId: number
  /** Nom anonymisé "Patient #N" iter 4 — iter futur vrai nom déchiffré. */
  displayName: string
}

export type MessagingContactsErrorCode =
  | "gdprConsentRevoked"
  | "forbidden"
  | "networkError"
  | "unexpectedError"

export interface UseMessagingContactsResult {
  contacts: MessagingContact[]
  isLoading: boolean
  error: MessagingContactsErrorCode | null
  refetch: () => Promise<void>
}

export function useMessagingContacts(opts: { skip?: boolean } = {}): UseMessagingContactsResult {
  const { skip = false } = opts
  const [contacts, setContacts] = useState<MessagingContact[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(!skip)
  const [error, setError] = useState<MessagingContactsErrorCode | null>(null)
  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchContacts = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const res = await fetch("/api/messaging/contacts", {
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
          // Distinguer gdprConsentRequired vs forbidden RBAC.
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          if (body.error === "gdprConsentRequired") {
            if (mountedRef.current) {
              setError("gdprConsentRevoked")
              setContacts([])
              setIsLoading(false)
            }
            return
          }
          if (mountedRef.current) {
            setError("forbidden")
            setContacts([])
            setIsLoading(false)
          }
          return
        }
        if (mountedRef.current) {
          setError("unexpectedError")
          setIsLoading(false)
        }
        return
      }
      // Fix M2 round 1 review PR #444 — explicit shape check (vs cast `raw as
      // { items?: unknown[] }` qui pouvait accepter null silently).
      const raw = (await res.json()) as unknown
      let items: unknown[] = []
      if (raw && typeof raw === "object" && "items" in raw && Array.isArray((raw as { items: unknown }).items)) {
        items = (raw as { items: unknown[] }).items
      } else if (Array.isArray(raw)) {
        // Defensive fallback si format change.
        items = raw
      }
      const mapped: MessagingContact[] = items
        .map((p): MessagingContact | null => {
          if (typeof p !== "object" || p === null) return null
          const obj = p as { patientId?: unknown; userId?: unknown; displayName?: unknown }
          const patientId = typeof obj.patientId === "number" ? obj.patientId : null
          const userId = typeof obj.userId === "number" ? obj.userId : null
          if (patientId === null || userId === null) return null
          // Backend retourne déjà displayName anonymisé — utiliser tel quel.
          const displayName =
            typeof obj.displayName === "string" && obj.displayName.length > 0
              ? obj.displayName
              : `Patient #${patientId}`
          return { patientId, userId, displayName }
        })
        .filter((c): c is MessagingContact => c !== null)

      if (mountedRef.current) {
        setContacts(mapped)
        setError(null)
        setIsLoading(false)
      }
    } catch (err) {
      logHookError("useMessagingContacts", err)
      if (mountedRef.current) {
        setError("networkError")
        setIsLoading(false)
      }
    } finally {
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (skip) {
      // Fix M3 round 1 review PR #444 — reset contacts au skip=true pour
      // éviter affichage liste stale 100-300ms lors d'un reopen modal
      // (skip flip true→false → refetch async, mais ancien array reste
      // visible avant le commit du nouveau fetch).
      if (mountedRef.current) {
        setContacts([])
        setIsLoading(false)
        setError(null)
      }
      return
    }
    if (mountedRef.current) setIsLoading(true)
    void fetchContacts()
  }, [skip, fetchContacts])

  return { contacts, isLoading, error, refetch: fetchContacts }
}
