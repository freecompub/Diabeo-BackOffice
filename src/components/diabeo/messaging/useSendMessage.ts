"use client"

/**
 * useSendMessage — hook POST `/api/messages`.
 *
 * US-2076-UI iter 3 — envoi message avec optimistic UI + whitelist codes
 * erreur HSA-3.
 *
 * **Contrat backend** (`/api/messages` POST) :
 *   - JWT auth + requireGdprConsent (émetteur + destinataire)
 *   - sendSchema : toUserId number + body string (max 8164 bytes UTF-8)
 *   - response 201 : `{ message: { id, conversationKey, fromUserId, toUserId,
 *     patientId, createdAt, fcm: { sent, failed } } }`
 *   - 422 validationFailed (body trop long / vide)
 *   - 403 forbidden (canMessage false : pas de lien patient↔PS / cabinet)
 *   - 403 gdprConsentRequired (consent OFF émetteur/destinataire)
 *   - 429 rateLimited
 *
 * **Codes erreur whitelist** :
 *   - `forbidden` (403 canMessage) / `gdprConsentRevoked` (403 consent)
 *   - `bodyTooLong` / `bodyEmpty` (422 validation)
 *   - `rateLimited` (429)
 *   - `networkError` / `unexpectedError`
 *
 * **Guard double-click** : in-flight ref (cohérent useConfirmAppointment
 * iter 11 RDV PR #438).
 */

import { useCallback, useEffect, useRef, useState } from "react"

export interface SendMessageInput {
  toUserId: number
  body: string
}

export interface SendMessageResult {
  id: string
  conversationKey: string
  fromUserId: number
  toUserId: number
  patientId: number | null
  createdAt: string // ISO 8601 from JSON
  fcm: { sent: number; failed: number }
}

export type SendMessageErrorCode =
  | "forbidden"
  | "gdprConsentRevoked"
  | "bodyTooLong"
  | "bodyEmpty"
  | "rateLimited"
  | "networkError"
  | "unexpectedError"

const ACCEPTED_CODES: ReadonlySet<SendMessageErrorCode> = new Set([
  "forbidden",
  "gdprConsentRevoked",
  "bodyTooLong",
  "bodyEmpty",
  "rateLimited",
  "networkError",
])

function normalizeError(raw: string | undefined): SendMessageErrorCode {
  if (raw === "gdprConsentRequired") return "gdprConsentRevoked"
  if (raw && ACCEPTED_CODES.has(raw as SendMessageErrorCode)) {
    return raw as SendMessageErrorCode
  }
  return "unexpectedError"
}

export type SendMessageOutcome =
  | { ok: true; data: SendMessageResult }
  | { ok: false; code: SendMessageErrorCode; retryAfterSeconds?: number }

export interface UseSendMessageResult {
  loading: boolean
  error: SendMessageErrorCode | null
  /**
   * Envoie un message. Retourne un Discriminated Union — JAMAIS throw.
   * Guard in-flight : 2e appel pendant le 1er → retourne `unexpectedError`
   * (silent — caller doit débounce / disable UI).
   */
  send: (input: SendMessageInput) => Promise<SendMessageOutcome>
  reset: () => void
}

export function useSendMessage(): UseSendMessageResult {
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<SendMessageErrorCode | null>(null)
  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)

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
  }, [])

  const send = useCallback(
    async (input: SendMessageInput): Promise<SendMessageOutcome> => {
      if (inFlightRef.current) {
        return { ok: false, code: "unexpectedError" }
      }
      inFlightRef.current = true
      if (mountedRef.current) {
        setLoading(true)
        setError(null)
      }
      try {
        const res = await fetch("/api/messages", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify(input),
        })
        if (!res.ok) {
          if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = "/login?expired=1"
            return { ok: false, code: "unexpectedError" }
          }
          if (res.status === 429) {
            const retryAfter = Number(res.headers.get("Retry-After")) || undefined
            if (mountedRef.current) setError("rateLimited")
            return { ok: false, code: "rateLimited", retryAfterSeconds: retryAfter }
          }
          const body = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown }
          const code = normalizeError(body.error)
          if (mountedRef.current) setError(code)
          return { ok: false, code }
        }
        const data = (await res.json()) as { message: SendMessageResult }
        return { ok: true, data: data.message }
      } catch (err) {
        if (process.env.NODE_ENV !== "production" && err instanceof Error) {
          console.warn("[useSendMessage] network error:", err.message)
        }
        if (mountedRef.current) setError("networkError")
        return { ok: false, code: "networkError" }
      } finally {
        inFlightRef.current = false
        if (mountedRef.current) setLoading(false)
      }
    },
    [],
  )

  return { loading, error, send, reset }
}
