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

import { useCallback, useState } from "react"

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

export interface CreateAppointmentResult {
  loading: boolean
  /**
   * Code d'erreur stable côté backend OU null si succès / pas submitté.
   * Le composant le map vers une i18n key générique pour l'affichage UI
   * (HSA-3 defense-in-depth — ne JAMAIS render brut).
   */
  error: string | null
  /** Submit le formulaire. Retourne `newId` (201) ou `null` si erreur. */
  submit: (input: CreateAppointmentInput) => Promise<number | null>
  /** Reset state (utile entre 2 ouvertures du modal). */
  reset: () => void
}

export function useCreateAppointment(): CreateAppointmentResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setError(null)
    setLoading(false)
  }, [])

  const submit = useCallback(async (input: CreateAppointmentInput): Promise<number | null> => {
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
      })

      if (!res.ok) {
        if (res.status === 401 && typeof window !== "undefined") {
          window.location.href = "/login?expired=1"
          return null
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `httpError:${res.status}`)
        return null
      }

      const data = (await res.json()) as { id: number }
      return data.id
    } catch (err) {
      setError(err instanceof Error ? err.message : "networkError")
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, error, submit, reset }
}
