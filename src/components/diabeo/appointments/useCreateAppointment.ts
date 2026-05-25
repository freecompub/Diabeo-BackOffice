"use client"

/**
 * useCreateAppointment — hook submit POST `/api/appointments` (création).
 *
 * US-2500-UI iter 6 — utilisé par `<AppointmentCreateModal>` pour soumettre
 * le formulaire. Backend valide via Zod, applique RBAC + consent + audit,
 * retourne `AppointmentDTO` (201).
 *
 * **Contrat backend** (cf. `src/app/api/appointments/route.ts:25-35`) :
 *   - `patientId` (int positive, required)
 *   - `memberId` (int positive, required)
 *   - `date` (yyyy-mm-dd, required)
 *   - `hour` (HH:MM, required)
 *   - `durationMinutes` (15-240, optional default 30)
 *   - `location` (`in_person` | `video` | `phone`, optional)
 *   - `type` (max 50, optional)
 *   - `motif` (max 200, optional — sera chiffré AES-256-GCM côté backend)
 *   - `note` (max 4096, optional — sera chiffré aussi)
 *
 * **Sécurité** :
 *   - Backend headers ANSSI sur réponse 201 (HSA-2-1 round 2 fix)
 *   - `motif`/`note` chiffrés à l'insertion en base via `encryptField`
 *   - Audit `CREATE` resource=APPOINTMENT, resourceId=newId, metadata.patientId
 *
 * **Errors** : 400 validation, 403 forbidden (canAccessPatient), 409 conflict
 * (EXCLUDE GiST slot membre), 422 consent (gdprConsentRequired).
 */

import { useCallback, useRef, useState } from "react"

export interface CreateAppointmentInput {
  patientId: number
  memberId: number
  date: string // yyyy-mm-dd
  hour: string // HH:MM
  durationMinutes?: number
  location?: "in_person" | "video" | "phone"
  type?: string
  motif?: string
  note?: string
}

/**
 * Fix CR-H2 + HSA-3 round 1 review PR #434 — Whitelist stricte des codes
 * d'erreur backend acceptés. Tout code non-listé tombe sur `unexpectedError`
 * pour empêcher le leak d'un message verbeux backend dans le state React
 * (defense-in-depth contre régression future qui exposerait du PHI/PII
 * dans `body.error`).
 *
 * Le composant `<AppointmentCreateModal>` map ces codes vers des i18n keys
 * distinctes pour donner un feedback médecin actionnable (vs "L'action a
 * échoué" générique qui pousse au re-clic en boucle).
 */
export type CreateAppointmentErrorCode =
  | "slotConflict"
  | "gdprConsentRequired"
  | "forbidden"
  | "validationFailed"
  | "networkError"
  | "unexpectedError"

const ACCEPTED_ERROR_CODES: ReadonlySet<CreateAppointmentErrorCode> = new Set([
  "slotConflict",
  "gdprConsentRequired",
  "forbidden",
  "validationFailed",
  "networkError",
])

function normalizeError(raw: string | undefined): CreateAppointmentErrorCode {
  if (raw === undefined) return "unexpectedError"
  if (ACCEPTED_ERROR_CODES.has(raw as CreateAppointmentErrorCode)) {
    return raw as CreateAppointmentErrorCode
  }
  return "unexpectedError"
}

export interface CreateAppointmentResult {
  loading: boolean
  /**
   * Code d'erreur normalisé côté hook (whitelist stricte) OU null si succès.
   * Le composant le map vers une i18n key distincte pour l'affichage UI
   * (HSA-3 defense-in-depth — ne JAMAIS render brut côté UI).
   */
  error: CreateAppointmentErrorCode | null
  /** Submit le formulaire. Retourne `newId` (201) ou `null` si erreur. */
  submit: (input: CreateAppointmentInput) => Promise<number | null>
  /** Reset state (utile entre 2 ouvertures du modal). */
  reset: () => void
}

export function useCreateAppointment(): CreateAppointmentResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<CreateAppointmentErrorCode | null>(null)
  // Fix FE-5 round 1 review PR #434 — AbortController cohérent pattern iter 5
  // (`useAppointmentDetail`). Cancel le POST si modal close pendant submit.
  // Conséquence : si user ferme le modal entre setActionLoading(true) et la
  // réponse, on évite le setState fantôme côté hook (warn React 19 silent).
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setError(null)
    setLoading(false)
  }, [])

  const submit = useCallback(async (input: CreateAppointmentInput): Promise<number | null> => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const myCtrl = ctrl

    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(input),
        signal: myCtrl.signal,
      })

      if (myCtrl.signal.aborted) return null

      if (!res.ok) {
        if (res.status === 401 && typeof window !== "undefined") {
          window.location.href = "/login?expired=1"
          return null
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (myCtrl.signal.aborted) return null
        setError(normalizeError(body.error))
        return null
      }

      const data = (await res.json()) as { id: number }
      if (myCtrl.signal.aborted) return null
      return data.id
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return null
      if (myCtrl.signal.aborted) return null
      setError(normalizeError(err instanceof Error ? err.message : undefined))
      return null
    } finally {
      if (!myCtrl.signal.aborted) setLoading(false)
    }
  }, [])

  return { loading, error, submit, reset }
}
