"use client"

/**
 * useAcceptAlternative — hook POST `/api/appointments/[id]/accept-alternative`.
 *
 * US-2500-UI iter 9 — Backoffice accept (NURSE+ accepte au nom du patient
 * une alternative proposée par le DOCTOR via iter 5 propose-alternative).
 *
 * **Contrat backend** (cf. `rdv.service.ts:604` + route /accept-alternative) :
 *   - precondition : `status === "cancelled"` ET `proposedAlternativeAt` set
 *     ET TTL 7j non dépassé
 *   - effet : status repasse à `scheduled` avec la nouvelle date+heure
 *   - audit `acceptAlternative` + `callerRole` (staff vs patient self-accept)
 *
 * **Codes erreur normalisés** (whitelist HSA-3 pattern iter 7) :
 *   - `notFound` (404)
 *   - `notCancelled` (422) — RDV pas en attente accept
 *   - `noAlternative` (422) — pas de proposedAlternativeAt
 *   - `alternativeExpired` (422) — TTL 7j dépassé
 *   - `slotOverlapAppointment` (422) — conflit nouveau créneau
 *   - `uniqueConflict` / `serializationConflict` (409)
 *   - `forbidden` (403)
 *
 * **Pattern** : cohérent `useUpdateAppointment` iter 7 — pas d'AbortController
 * (backend Schedule-X/cancel sérialisent naturellement les mutations),
 * mountedRef cleanup, retour structuré `{ ok: true, dto } | { ok: false, code }`.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { UpdatedAppointmentLite } from "./useUpdateAppointment"

export type AcceptAlternativeErrorCode =
  | "notFound"
  | "notCancelled"
  | "noAlternative"
  | "alternativeExpired"
  | "slotOverlapAppointment"
  | "slotOverlapUnavailability"
  | "uniqueConflict"
  | "serializationConflict"
  | "forbidden"
  | "validationFailed"
  | "networkError"
  | "unexpectedError"

const ACCEPTED_CODES: ReadonlySet<AcceptAlternativeErrorCode> = new Set([
  "notFound",
  "notCancelled",
  "noAlternative",
  "alternativeExpired",
  "slotOverlapAppointment",
  "slotOverlapUnavailability",
  "uniqueConflict",
  "serializationConflict",
  "forbidden",
  "validationFailed",
  "networkError",
])

function normalizeError(raw: string | undefined): AcceptAlternativeErrorCode {
  if (raw === undefined) return "unexpectedError"
  if (ACCEPTED_CODES.has(raw as AcceptAlternativeErrorCode)) {
    return raw as AcceptAlternativeErrorCode
  }
  return "unexpectedError"
}

export type AcceptAlternativeResult =
  | { ok: true; dto: UpdatedAppointmentLite }
  | { ok: false; code: AcceptAlternativeErrorCode }

export interface UseAcceptAlternativeResult {
  loading: boolean
  error: AcceptAlternativeErrorCode | null
  submit: (id: number) => Promise<AcceptAlternativeResult>
  reset: () => void
}

export function useAcceptAlternative(): UseAcceptAlternativeResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AcceptAlternativeErrorCode | null>(null)
  const mountedRef = useRef(true)
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

  const submit = useCallback(
    async (id: number): Promise<AcceptAlternativeResult> => {
      if (mountedRef.current) {
        setLoading(true)
        setError(null)
      }
      try {
        const res = await fetch(`/api/appointments/${id}/accept-alternative`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
        })
        if (!res.ok) {
          if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = "/login?expired=1"
            return { ok: false, code: "unexpectedError" }
          }
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          const code = normalizeError(body.error)
          if (mountedRef.current) setError(code)
          return { ok: false, code }
        }
        const dto = (await res.json()) as UpdatedAppointmentLite
        return { ok: true, dto }
      } catch (err) {
        const code = normalizeError(err instanceof Error ? err.message : undefined)
        if (mountedRef.current) setError(code)
        return { ok: false, code }
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    },
    [],
  )

  return { loading, error, submit, reset }
}
