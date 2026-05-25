"use client"

/**
 * useConfirmAppointment — hook POST `/api/appointments/[id]/confirm`.
 *
 * US-2500-UI iter 11 — bookingMode validation manuelle : quand
 * `HealthcareMember.bookingMode === "validation"` (US-2505), les RDV créés
 * démarrent en status `pending_validation` (vs `scheduled` en mode auto).
 * Un DOCTOR+ doit explicitement les confirmer via cette route pour passer
 * en `scheduled`.
 *
 * **Contrat backend** (`rdv.service.ts:671+` + `/api/appointments/[id]/confirm`) :
 *   - precondition : `status === "pending_validation"`
 *   - effet : status passe à `scheduled`
 *   - RBAC : DOCTOR+ (NURSE refuse 403)
 *   - audit `confirm` côté backend
 *
 * **Codes erreur normalisés** (whitelist HSA-3 pattern iter 7/9) :
 *   - `notFound` (404)
 *   - `notPending` (422) — RDV pas en attente
 *   - `forbidden` (403) — NURSE/VIEWER
 *   - `validationFailed` (400)
 *
 * **Pattern** : cohérent `useAcceptAlternative` iter 9 — mountedRef cleanup,
 * retour structuré `{ ok: true, dto } | { ok: false, code }`.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { UpdatedAppointmentLite } from "./useUpdateAppointment"

export type ConfirmAppointmentErrorCode =
  | "notFound"
  | "notPending"
  | "forbidden"
  | "validationFailed"
  | "networkError"
  | "unexpectedError"

const ACCEPTED_CODES: ReadonlySet<ConfirmAppointmentErrorCode> = new Set([
  "notFound",
  "notPending",
  "forbidden",
  "validationFailed",
  "networkError",
])

function normalizeError(raw: string | undefined): ConfirmAppointmentErrorCode {
  if (raw === undefined) return "unexpectedError"
  if (ACCEPTED_CODES.has(raw as ConfirmAppointmentErrorCode)) {
    return raw as ConfirmAppointmentErrorCode
  }
  return "unexpectedError"
}

export type ConfirmAppointmentResult =
  | { ok: true; dto: UpdatedAppointmentLite }
  | { ok: false; code: ConfirmAppointmentErrorCode }

export interface UseConfirmAppointmentResult {
  loading: boolean
  error: ConfirmAppointmentErrorCode | null
  submit: (id: number) => Promise<ConfirmAppointmentResult>
  reset: () => void
}

export function useConfirmAppointment(): UseConfirmAppointmentResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ConfirmAppointmentErrorCode | null>(null)
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
    async (id: number): Promise<ConfirmAppointmentResult> => {
      if (mountedRef.current) {
        setLoading(true)
        setError(null)
      }
      try {
        const res = await fetch(`/api/appointments/${id}/confirm`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "X-Requested-With": "XMLHttpRequest" },
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
    // Deps vide intentionnel cohérent pattern hooks iter 5/6/7/9 :
    // mountedRef useRef stable, setters useState identité stable React.
    [],
  )

  return { loading, error, submit, reset }
}
