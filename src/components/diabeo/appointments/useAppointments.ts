"use client"

/**
 * useAppointments — hook pour fetch `/api/appointments` en range query.
 *
 * Le backend `rdvAppointmentService.listInRange` (PR #392 US-2500) impose :
 *   - `memberId` OU `patientId` requis (scope, `scopeRequired` sinon)
 *   - Range max 62 jours (RANGE_MAX_DAYS)
 *   - Réponse `{ items: AppointmentListItemDTO[], truncated: boolean }`
 *
 * Polling 60s par défaut (cohérent avec `/dashboard/medecin/appointments`).
 *
 * Refetch automatique quand `from`/`to`/`memberId`/`patientId`/`status` change.
 *
 * @see src/app/api/appointments/route.ts
 * @see src/lib/services/rdv.service.ts → listInRange
 */

import { useEffect, useState, useCallback, useRef } from "react"
import type { AppointmentStatus, AppointmentLocation } from "@prisma/client"

export interface AppointmentListItem {
  id: number
  patientId: number
  memberId: number | null
  type: string | null
  date: string // ISO date (yyyy-mm-dd) — server-side @db.Date
  hour: string | null // ISO time (hh:mm:ss) — server-side @db.Time
  durationMinutes: number | null
  location: AppointmentLocation | null
  status: AppointmentStatus
  motif: string | null
  proposedAlternativeAt: string | null
  cancelledBy: "patient" | "professional" | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

export interface UseAppointmentsParams {
  from: Date
  to: Date
  memberId?: number
  patientId?: number
  status?: AppointmentStatus
  /** Polling interval ms. Default 60_000. 0 = disabled. */
  refreshInterval?: number
  /** Skip fetch if no scope defined (memberId/patientId both undefined). */
  skip?: boolean
}

export interface UseAppointmentsResult {
  items: AppointmentListItem[]
  truncated: boolean
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

const DEFAULT_REFRESH_MS = 60_000

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]
}

export function useAppointments({
  from,
  to,
  memberId,
  patientId,
  status,
  refreshInterval = DEFAULT_REFRESH_MS,
  skip,
}: UseAppointmentsParams): UseAppointmentsResult {
  const [items, setItems] = useState<AppointmentListItem[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // M3 round 2 — Use refs for stable refetch identity (avoids polling re-mount).
  const paramsRef = useRef({ from, to, memberId, patientId, status })
  paramsRef.current = { from, to, memberId, patientId, status }

  const scopeMissing =
    paramsRef.current.memberId === undefined && paramsRef.current.patientId === undefined

  const refetch = useCallback(async () => {
    if (skip || scopeMissing) {
      setItems([])
      setTruncated(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      params.set("from", formatDate(paramsRef.current.from))
      params.set("to", formatDate(paramsRef.current.to))
      if (paramsRef.current.memberId !== undefined) {
        params.set("memberId", String(paramsRef.current.memberId))
      }
      if (paramsRef.current.patientId !== undefined) {
        params.set("patientId", String(paramsRef.current.patientId))
      }
      if (paramsRef.current.status) {
        params.set("status", paramsRef.current.status)
      }

      const res = await fetch(`/api/appointments?${params.toString()}`, {
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `httpError:${res.status}`)
        setItems([])
        setTruncated(false)
        return
      }

      const data = (await res.json()) as {
        items: AppointmentListItem[]
        truncated: boolean
      }
      setItems(data.items ?? [])
      setTruncated(data.truncated ?? false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "networkError")
      setItems([])
      setTruncated(false)
    } finally {
      setLoading(false)
    }
  }, [skip, scopeMissing])

  // Initial fetch + refetch on params change (from/to/scope/status).
  useEffect(() => {
    void refetch()
  }, [refetch, from.getTime(), to.getTime(), memberId, patientId, status])

  // Polling interval (paused while loading or on error).
  useEffect(() => {
    if (refreshInterval <= 0 || skip || scopeMissing) return
    const id = setInterval(() => {
      void refetch()
    }, refreshInterval)
    return () => clearInterval(id)
  }, [refetch, refreshInterval, skip, scopeMissing])

  return { items, truncated, loading, error, refetch }
}
