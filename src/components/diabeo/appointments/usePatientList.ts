"use client"

/**
 * usePatientList — hook fetch liste patients accessibles pour le modal
 * création RDV (`<AppointmentCreateModal>`).
 *
 * US-2500-UI iter 6 — alimente le `<PatientCombobox>` autocomplete.
 *
 * **Stratégie** : fetch `limit=50` initial (cabinet typique < 50 patients
 * actifs), filtrage côté client par nom/prénom. Si > 50 patients, taper un
 * nom/prénom **complet** déclenche un fetch ciblé : le backend tokenise la
 * saisie et matche chaque mot par HMAC exact (`search`), cf. patient.service.
 *
 * **Usage** : `<PatientCombobox>` instancie ce hook DEUX fois — une liste
 * "base" (`enabled:true`, sans `search`) fetchée une fois, et une instance de
 * recherche complémentaire (`search` différé via `useDeferredValue` + gate
 * min-length côté composant — PAS un debounce réseau) dont les résultats sont
 * mergés à la base. Chaque instance gère son propre `AbortController`.
 *
 * Endpoint : `GET /api/patients/search?limit=50` (US-2019).
 * Réponse : `{ items: [{ id, user: { firstname, lastname, ... } }], nextCursor }`.
 *
 * **Sécurité** :
 *   - Scope automatique côté backend (RBAC ADMIN/DOCTOR/NURSE = patients
 *     du service ; VIEWER = self) — pas de cross-tenant leak.
 *   - PHI nom/prénom déchiffré côté backend, présent en mémoire React tant
 *     que le modal est ouvert. Hook reset au modal close (cf. modal parent).
 *
 * **Lifecycle** :
 *   - `enabled=false` (modal fermé) → idle, pas de fetch
 *   - `enabled=true` → fetch initial + refetch sur `search` change (différé)
 *
 * @see src/app/api/patients/search/route.ts
 * @see src/lib/services/patient.service.ts → search
 */

import { useCallback, useEffect, useRef, useState } from "react"

export interface PatientListItem {
  id: number
  firstname: string | null
  lastname: string | null
}

export interface UsePatientListResult {
  items: PatientListItem[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export interface UsePatientListParams {
  /** Active le fetch (false = modal fermé, hook idle). */
  enabled: boolean
  /** Search exact match (HMAC backend) — différé via useDeferredValue + gate
   * min-length côté composant parent (pas un debounce réseau). */
  search?: string
}

export function usePatientList({ enabled, search }: UsePatientListParams): UsePatientListResult {
  const [items, setItems] = useState<PatientListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refetch = useCallback(async () => {
    if (!enabled) {
      abortRef.current?.abort()
      setItems([])
      setError(null)
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const myCtrl = ctrl

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ limit: "50" })
      if (search && search.trim().length > 0) {
        params.set("search", search.trim())
      }

      const res = await fetch(`/api/patients/search?${params.toString()}`, {
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
        if (myCtrl.signal.aborted) return
        setError(body.error ?? `httpError:${res.status}`)
        return
      }

      const data = (await res.json()) as {
        items: Array<{ id: number; user: { firstname: string | null; lastname: string | null } }>
      }
      if (myCtrl.signal.aborted) return
      // Flatten en `PatientListItem` (firstname/lastname directement sur l'item)
      setItems(
        (data.items ?? []).map((p) => ({
          id: p.id,
          firstname: p.user?.firstname ?? null,
          lastname: p.user?.lastname ?? null,
        })),
      )
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (myCtrl.signal.aborted) return
      setError(err instanceof Error ? err.message : "networkError")
    } finally {
      if (!myCtrl.signal.aborted) setLoading(false)
    }
  }, [enabled, search])

  useEffect(() => {
    void refetch()
    return () => {
      abortRef.current?.abort()
    }
  }, [refetch])

  return { items, loading, error, refetch }
}
