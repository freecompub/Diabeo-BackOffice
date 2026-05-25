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
 * **Codes erreur backend** (Fix CR-1 + HSA-3 round 1 review PR #435) :
 *   Whitelist vérifiée contre `rdv.service.ts` méthode `update` :
 *   - `forbidden` (403) — canAccessPatient gate
 *   - `notFound` (404) — apptId inexistant
 *   - `alreadyClosed` (422) — RDV en statut terminal (cancelled/completed/no_show)
 *   - `slotOverlapAppointment` (422) — conflit créneau patient
 *   - `slotOverlapUnavailability` (422) — conflit indispo membre
 *   - `uniqueConflict` (409) — Prisma P2002 (race slot)
 *   - `serializationConflict` (409) — Prisma P2034 (retry possible)
 *   - `validationFailed` (400) — Zod route OU motif/note/durationMinutes
 *   - tout autre → `unexpectedError` (HSA-3 defense-in-depth)
 *
 * **Sécurité** :
 *   - Backend headers ANSSI sur réponse 200 (HSA-2-1 round 2 fix iter 5)
 *   - Audit `UPDATE` ciblé côté backend (resource=APPOINTMENT, metadata.patientId)
 *   - Render uniquement clé i18n normalisée jamais code brut (HSA-3)
 *
 * **Fix CR-4 + FE-5 round 1 review PR #435** : `submit` retourne le DTO mis
 * à jour (vs juste bool). Le parent peut appeler `eventsService.update(dto)`
 * pour patcher localement Schedule-X au lieu de `refetch()` la fenêtre entière
 * (52 jours = ~50KB transit + N audits READ par item — coût RGPD audit).
 *
 * **Pattern** : pas d'AbortController (Fix HSA-2 round 1 — voir docstring de
 * `submit`). Les PUT mutations sont sériées implicitement par le caller via
 * Schedule-X qui attend `Promise<boolean>` avant de débloquer un nouveau drag.
 */

import { useCallback, useEffect, useRef, useState } from "react"

export type UpdateAppointmentErrorCode =
  | "alreadyClosed"
  | "slotOverlapAppointment"
  | "slotOverlapUnavailability"
  | "uniqueConflict"
  | "serializationConflict"
  | "forbidden"
  | "notFound"
  | "validationFailed"
  | "networkError"
  | "unexpectedError"

const ACCEPTED_ERROR_CODES: ReadonlySet<UpdateAppointmentErrorCode> = new Set([
  "alreadyClosed",
  "slotOverlapAppointment",
  "slotOverlapUnavailability",
  "uniqueConflict",
  "serializationConflict",
  "forbidden",
  "notFound",
  "validationFailed",
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

/** Shape minimal du DTO retourné par PUT — utilisé par `eventsService.update`. */
export interface UpdatedAppointmentLite {
  id: number
  date: string // ISO
  hour: string | null // ISO time
  durationMinutes: number | null
  status: string
}

export type UpdateAppointmentResult =
  | { ok: true; dto: UpdatedAppointmentLite }
  | { ok: false; code: UpdateAppointmentErrorCode }

export interface UseUpdateAppointmentResult {
  loading: boolean
  error: UpdateAppointmentErrorCode | null
  /**
   * Submit le patch. Retourne `{ ok: true, dto }` ou `{ ok: false, code }`.
   * Fix CR-4/FE-5 round 1 — retour structuré pour permettre au caller de
   * patcher Schedule-X localement (vs full refetch).
   *
   * Note CR-7 + HSA-2 round 1 : pas d'AbortController. Schedule-X sérialise
   * les drag callbacks naturellement (un drag attend la résolution de la
   * Promise avant qu'un nouveau drag commence). Pas de race entre 2 PUT
   * simultanés.
   */
  submit: (id: number, patch: UpdateAppointmentPatch) => Promise<UpdateAppointmentResult>
  /** Reset state (utile entre 2 ouvertures). */
  reset: () => void
}

export function useUpdateAppointment(): UseUpdateAppointmentResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<UpdateAppointmentErrorCode | null>(null)
  // Fix CR-7 round 1 — mountedRef pour gate setState sur composant unmounted.
  // (Pas d'AbortController vu qu'on n'abort plus les PUT — Schedule-X sérialise.)
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
    async (id: number, patch: UpdateAppointmentPatch): Promise<UpdateAppointmentResult> => {
      if (mountedRef.current) {
        setLoading(true)
        setError(null)
      }
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
