"use client"

/**
 * useAppointmentDetail — hook pour fetch `/api/appointments/[id]`.
 *
 * US-2500-UI iter 5 — clic sur un événement Schedule-X ouvre le modal détail
 * qui consume ce hook. Le backend déchiffre `motif`, `note`, `cancelReason`
 * (AES-256-GCM) et émet un audit READ ciblé (`resource=APPOINTMENT`,
 * `resourceId=appt.id`, `metadata.patientId`).
 *
 * **Cache-Control: no-store** côté backend + `cache: "no-store"` côté fetch =
 * pas de cache HTTP ni mémoire du payload déchiffré (Art. 5.1.c minimisation).
 *
 * Lifecycle :
 *   - `id === null` → idle (modal fermé, hook ne fetch rien)
 *   - `id` set → fetch + audit READ tiré
 *   - Modal fermé → AbortController cancel in-flight + state reset
 *
 * **AbortController** : protège contre la fuite d'audit READ "fantôme" si le
 * user ferme le modal avant que la réponse arrive (sinon audit log persisté
 * pour rien + payload déchiffré laisse une trace réseau).
 *
 * @see src/app/api/appointments/[id]/route.ts → GET handler
 * @see src/lib/services/rdv.service.ts → getById
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { AppointmentStatus, AppointmentLocation } from "@prisma/client"

/**
 * DTO du detail — calque sur `AppointmentDTO` du service.
 * Note : `motif` / `note` / `cancelReason` sont **déchiffrés** par le backend.
 * Le state React les contient en clair pendant que le modal est ouvert.
 */
export interface AppointmentDetail {
  id: number
  patientId: number
  memberId: number | null
  type: string | null
  date: string // ISO yyyy-mm-dd
  hour: string | null // ISO hh:mm:ss
  durationMinutes: number | null
  location: AppointmentLocation | null
  status: AppointmentStatus
  motif: string | null // décrypté
  note: string | null // décrypté
  proposedAlternativeAt: string | null
  cancelledBy: "patient" | "professional" | null
  cancelReason: string | null // décrypté
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

export interface UseAppointmentDetailResult {
  detail: AppointmentDetail | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useAppointmentDetail(
  id: number | null,
): UseAppointmentDetailResult {
  const [detail, setDetail] = useState<AppointmentDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refetch = useCallback(async () => {
    if (id === null) {
      // Modal fermé — reset state, annule fetch en cours.
      abortRef.current?.abort()
      setDetail(null)
      setError(null)
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // Fix H-2 round 1 review PR #433 — capture local du ctrl pour le `finally` :
    // sans ça, `abortRef.current?.signal.aborted` teste le NOUVEAU ctrl (vu que
    // `abortRef.current` est réassigné lors du fetch suivant), ce qui faisait
    // que le `finally` du VIEUX fetch reset `loading=false` pendant que le
    // nouveau fetch est en cours → glitch UX visible (loading clignote).
    const myCtrl = ctrl

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/appointments/${id}`, {
        credentials: "include",
        cache: "no-store",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        signal: myCtrl.signal,
      })

      if (myCtrl.signal.aborted) return

      if (!res.ok) {
        if (res.status === 401 && typeof window !== "undefined") {
          window.location.href = "/login?expired=1"
          return
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `httpError:${res.status}`)
        return
      }

      const data = (await res.json()) as AppointmentDetail
      setDetail(data)
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      setError(err instanceof Error ? err.message : "networkError")
    } finally {
      // Fix H-2 — utiliser `myCtrl` (closure stable) au lieu de `abortRef.current`
      // (qui a pu être remplacé par un fetch concurrent).
      if (!myCtrl.signal.aborted) setLoading(false)
    }
  }, [id])

  // Refetch sur id change. id=null → reset state via refetch.
  useEffect(() => {
    void refetch()
    return () => {
      abortRef.current?.abort()
    }
  }, [refetch])

  return { detail, loading, error, refetch }
}
