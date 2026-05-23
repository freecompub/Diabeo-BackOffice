"use client"

/**
 * useMyMemberships — hook pour fetch `/api/account/me-memberships`.
 *
 * US-2500-UI iter 4 — pré-résolution du memberId courant pour le
 * calendrier RDV. Évite le state "Sélectionnez un filtre" par défaut
 * quand le DOCTOR/NURSE a un seul membership cabinet (cas dominant).
 *
 * Pas de polling — les memberships changent rarement (admin change
 * d'affectation). 1 fetch au mount, lifecycle session.
 */

import { useEffect, useState, useCallback } from "react"

export interface Membership {
  memberId: number
  memberName: string
  serviceId: number
  serviceName: string
  establishment: string | null
}

export interface UseMyMembershipsResult {
  items: Membership[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useMyMemberships(): UseMyMembershipsResult {
  const [items, setItems] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/account/me-memberships", {
        credentials: "include",
        cache: "no-store",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
      if (!res.ok) {
        if (res.status === 401 && typeof window !== "undefined") {
          window.location.href = "/login?expired=1"
          return
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `httpError:${res.status}`)
        return
      }
      const data = (await res.json()) as { items: Membership[] }
      setItems(data.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "networkError")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { items, loading, error, refetch }
}
