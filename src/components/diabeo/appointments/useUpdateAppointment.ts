"use client"

/**
 * useUpdateAppointment — hook submit PUT `/api/appointments/[id]` (move RDV).
 *
 * US-2500-UI iter 7 — utilisé par `<AppointmentCalendar>` pour persister un
 * déplacement drag & drop. Backend valide via Zod + RBAC + audit, retourne
 * `AppointmentDTO` mis à jour (200).
 *
 * **Contrat backend** (cf. `src/app/api/appointments/[id]/route.ts:17-25`) :
 *   - `date` (yyyy-mm-dd) optionnel
 *   - `hour` (HH:MM) optionnel
 *   - `durationMinutes` (15-240) optionnel
 *   - autres champs (location, type, motif, note) optionnels — non utilisés ici
 *
 * **Sécurité** :
 *   - Backend headers ANSSI sur réponse 200 (HSA-2-1 round 2 fix iter 5)
 *   - Audit `UPDATE` ciblé côté backend (resource=APPOINTMENT, metadata.patientId)
 *   - Whitelist codes erreur cohérente avec `useCreateAppointment` (HSA-3)
 *
 * **Pattern** : `submit(id, patch)` retourne `boolean` — true = succès, false =
 * erreur. Schedule-X `onBeforeEventUpdateAsync` consume ce bool pour rollback.
 */

import { useCallback, useRef, useState } from "react"

export type UpdateAppointmentErrorCode =
  | "slotConflict"
  | "forbidden"
  | "validationFailed"
  | "notFound"
  | "appointmentNotEditable"
  | "networkError"
  | "unexpectedError"

const ACCEPTED_ERROR_CODES: ReadonlySet<UpdateAppointmentErrorCode> = new Set([
  "slotConflict",
  "forbidden",
  "validationFailed",
  "notFound",
  "appointmentNotEditable",
  "networkError",
])

function normalizeError(raw: string | undefined): UpdateAppointmentErrorCode {
  if (raw === undefined) return "unexpectedError"
  if (ACCEPTED_ERROR_CODES.has(raw as UpdateAppointmentErrorCode)) {
    return raw as UpdateAppointmentErrorCode
  }
  return "unexpectedError"
}

export interface UpdateAppointmentPatch {
  date?: string // yyyy-mm-dd
  hour?: string // HH:MM
  durationMinutes?: number
}

export interface UseUpdateAppointmentResult {
  loading: boolean
  error: UpdateAppointmentErrorCode | null
  /** Submit le patch. Retourne `true` si 200, `false` si erreur. */
  submit: (id: number, patch: UpdateAppointmentPatch) => Promise<boolean>
  /** Reset state. */
  reset: () => void
}

export function useUpdateAppointment(): UseUpdateAppointmentResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<UpdateAppointmentErrorCode | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setError(null)
    setLoading(false)
  }, [])

  const submit = useCallback(
    async (id: number, patch: UpdateAppointmentPatch): Promise<boolean> => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      const myCtrl = ctrl

      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/appointments/${id}`, {
          method: "PUT",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify(patch),
          signal: myCtrl.signal,
        })

        if (myCtrl.signal.aborted) return false

        if (!res.ok) {
          if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = "/login?expired=1"
            return false
          }
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          if (myCtrl.signal.aborted) return false
          setError(normalizeError(body.error))
          return false
        }

        return true
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return false
        if (myCtrl.signal.aborted) return false
        setError(normalizeError(err instanceof Error ? err.message : undefined))
        return false
      } finally {
        if (!myCtrl.signal.aborted) setLoading(false)
      }
    },
    [],
  )

  return { loading, error, submit, reset }
}
