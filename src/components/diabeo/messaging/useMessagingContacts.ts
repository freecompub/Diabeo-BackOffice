"use client"

/**
 * useMessagingContacts — hook GET `/api/patients` filtré pour le modal
 * "Nouveau message".
 *
 * US-2076-UI iter 4 — fetch la liste des patients du PS connecté (already
 * gated NURSE+ backend). Le pro peut messager ses patients via `canMessage`
 * (PatientService / PatientReferent). Backend re-vérifie au POST `/api/messages`.
 *
 * **Anonymisation iter 4** : on affiche `Patient #N` (cohérent ThreadList iter 2).
 * iter futur résoudra le vrai nom via endpoint séparé.
 *
 * **Codes erreur HSA-3** :
 *   - `forbidden` (403) — PS sans patients
 *   - `networkError`
 *   - `unexpectedError`
 *
 * **Note** : pas de polling — on fetch UNE FOIS au mount du modal. Si V1.5
 * UX demande mise à jour temps réel, intégrer usePolling helper (PR #441).
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

export type MessagingContactsErrorCode = "forbidden" | "networkError" | "unexpectedError"

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
      const res = await fetch("/api/patients", {
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
          if (mountedRef.current) {
            setError("forbidden")
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
      // Backend retourne array directe (legacy `/api/patients`).
      // Defensive : si shape change un jour (wrap {items}), on accepte les deux.
      const raw = (await res.json()) as unknown
      const items: unknown[] = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { items?: unknown[] })?.items)
          ? (raw as { items: unknown[] }).items
          : []
      const mapped: MessagingContact[] = items
        .map((p): MessagingContact | null => {
          if (typeof p !== "object" || p === null) return null
          const obj = p as { id?: unknown; userId?: unknown }
          const patientId = typeof obj.id === "number" ? obj.id : null
          const userId = typeof obj.userId === "number" ? obj.userId : null
          if (patientId === null || userId === null) return null
          return {
            patientId,
            userId,
            displayName: `Patient #${patientId}`,
          }
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
    if (skip) return
    void fetchContacts()
  }, [skip, fetchContacts])

  return { contacts, isLoading, error, refetch: fetchContacts }
}
