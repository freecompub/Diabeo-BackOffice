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
 *
 * Fix H-1/H-2/H-5 round 2 review PR #432 :
 *   - `AbortController` cleanup au unmount (cohérent `useAppointments`)
 *   - `items: null` initial (distingue "pas chargé" vs "chargé vide")
 *   - `lastFetchedAt` exposé (cohérent `useAppointments`)
 */

import { useEffect, useState, useCallback, useRef } from "react"

export interface Membership {
  memberId: number
  memberName: string
  serviceId: number
  serviceName: string
  establishment: string | null
}

export interface UseMyMembershipsResult {
  /**
   * Fix H-5 round 2 — `items` est `Membership[]` quand chargé (peut être `[]`),
   * jamais `null` côté composant (mappé `?? []` au retour). Évite la
   * confusion "pas encore chargé" vs "0 résultat" : le composant doit
   * vérifier `loading` pour faire la distinction.
   */
  items: Membership[]
  /** True tant que le premier fetch n'a pas réussi (initialLoading flag). */
  loading: boolean
  error: string | null
  lastFetchedAt: Date | null
  refetch: () => Promise<void>
}

export function useMyMemberships(): UseMyMembershipsResult {
  const [items, setItems] = useState<Membership[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null)

  // Fix H-1 round 2 — AbortController cleanup au unmount (cohérent
  // `useAppointments`). Évite setState post-unmount + race strict mode.
  const abortRef = useRef<AbortController | null>(null)

  const refetch = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/account/me-memberships", {
        credentials: "include",
        cache: "no-store",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        signal: ctrl.signal,
      })

      if (ctrl.signal.aborted) return

      if (!res.ok) {
        if (res.status === 401 && typeof window !== "undefined") {
          window.location.href = "/login?expired=1"
          return
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `httpError:${res.status}`)
        // H-7 pattern : ne pas reset items pour préserver cache stale-while-error.
        return
      }
      const data = (await res.json()) as { items: Membership[] }
      setItems(data.items ?? [])
      setLastFetchedAt(new Date())
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      setError(err instanceof Error ? err.message : "networkError")
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refetch()
    return () => {
      abortRef.current?.abort()
    }
  }, [refetch])

  return {
    // Mappage `null → []` à l'interface publique pour simplifier les
    // consumers (qui peuvent se baser uniquement sur `loading` pour
    // distinguer "pas chargé" vs "0 résultat").
    items: items ?? [],
    loading,
    error,
    lastFetchedAt,
    refetch,
  }
}
