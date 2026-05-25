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

/**
 * Fix H-3 round 2 review PR #431 — DTO d'affichage calendrier SANS
 * `motif` (PHI consultation). Le backend `AppointmentListItemDTO`
 * inclut `motif: string | null` déchiffré, mais l'UI ne l'affiche
 * jamais dans le calendrier (cf. `adapter.ts` title anti-PHI strict).
 *
 * Strip côté frontend en defense-in-depth contre :
 *   - Fuite via DevTools (network tab visible des tiers shoulder-surfing)
 *   - Perte audit READ_DETAIL ciblé (RGPD Art. 5.1.c minimisation)
 *   - Browser cache disk persistance (cohérent avec Cache-Control no-store H-2)
 *
 * Suivi V1.5 : créer `AppointmentCalendarItemDTO` côté backend qui
 * exclut `motif` dans le payload list. Cf. issue à créer pour PR #392.
 */
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
  // motif: string | null — SUPPRIMÉ côté UI (H-3 strip defense-in-depth)
  proposedAlternativeAt: string | null
  cancelledBy: "patient" | "professional" | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Raw API response (inclut `motif` PHI). On strip dans le hook avant
 * d'exposer au composant.
 */
interface RawAppointmentListItem extends AppointmentListItem {
  motif: string | null
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
  /** Fix M-6 — `isInitialLoading` true uniquement avant le 1er fetch success. */
  isInitialLoading: boolean
  error: string | null
  /** Fix H-7 — preserve last successful timestamp for stale-while-error UX. */
  lastFetchedAt: Date | null
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
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null)

  // M3 round 2 — Use refs for stable refetch identity (avoids polling re-mount).
  const paramsRef = useRef({ from, to, memberId, patientId, status })
  paramsRef.current = { from, to, memberId, patientId, status }

  // Fix H-1 round 2 review PR #431 — AbortController to cancel in-flight
  // fetches when params change (navigation, polling tick collision).
  const abortRef = useRef<AbortController | null>(null)

  const scopeMissing =
    paramsRef.current.memberId === undefined && paramsRef.current.patientId === undefined

  const refetch = useCallback(async () => {
    if (skip || scopeMissing) {
      setItems([])
      setTruncated(false)
      return
    }

    // Fix H-1 — abort previous in-flight fetch before starting new one.
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // Snapshot params at fetch time pour comparer à l'arrivée (defense
    // contre race condition même après abort si callback déjà queued).
    const snapshot = { ...paramsRef.current }

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      params.set("from", formatDate(snapshot.from))
      params.set("to", formatDate(snapshot.to))
      if (snapshot.memberId !== undefined) {
        params.set("memberId", String(snapshot.memberId))
      }
      if (snapshot.patientId !== undefined) {
        params.set("patientId", String(snapshot.patientId))
      }
      if (snapshot.status) {
        params.set("status", snapshot.status)
      }

      const res = await fetch(`/api/appointments?${params.toString()}`, {
        credentials: "include",
        // Fix H-2 — `cache: "no-store"` côté client en defense-in-depth ;
        // backend doit aussi envoyer `Cache-Control: no-store` (cf. PR #392).
        cache: "no-store",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        signal: ctrl.signal,
      })

      // Si la requête a été abort entre temps OU si les params ont changé,
      // ignorer la réponse (race condition defense-in-depth).
      if (ctrl.signal.aborted) return
      if (snapshot.memberId !== paramsRef.current.memberId
        || snapshot.patientId !== paramsRef.current.patientId) {
        return
      }

      if (!res.ok) {
        // Fix M-2 — 401 (JWT expired) → redirect /login plutôt que de
        // laisser l'user sur page calendrier vide silencieusement.
        if (res.status === 401 && typeof window !== "undefined") {
          window.location.href = "/login?expired=1"
          return
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `httpError:${res.status}`)
        // Fix H-7 — NE PAS reset items sur erreur polling pour préserver
        // le cache UX (stale-while-error). User voit "15 RDV" + bannière
        // erreur, mieux que page vide qui clignote anxiogène.
        return
      }

      const data = (await res.json()) as {
        items: RawAppointmentListItem[]
        truncated: boolean
      }

      // Fix H-3 — strip `motif` côté frontend defense-in-depth.
      // Bien que le payload réseau contienne encore motif (à fixer
      // côté backend US-2500-DTO V1.5), le state React ne le persiste
      // pas → moins d'exposure mémoire + meilleure pratique audit.
      const stripped: AppointmentListItem[] = (data.items ?? []).map((r) => {
        const { motif: _motif, ...rest } = r
        return rest
      })
      setItems(stripped)
      setTruncated(data.truncated ?? false)
      setLastFetchedAt(new Date())
    } catch (err) {
      // AbortError = pas une vraie erreur (user-initiated cancel).
      if (err instanceof Error && err.name === "AbortError") return
      setError(err instanceof Error ? err.message : "networkError")
      // Fix H-7 — ne pas reset items (preserve cache).
    } finally {
      setLoading(false)
      setIsInitialLoading(false)
    }
  }, [skip, scopeMissing])

  // Initial fetch + refetch on params change (from/to/scope/status).
  // Fix react-hooks/exhaustive-deps round 1 PR #436 — extract `from.getTime()`
  // et `to.getTime()` en variables stables (la règle refuse les expressions
  // complexes dans le dep array pour permettre l'analyse statique).
  const fromMs = from.getTime()
  const toMs = to.getTime()
  useEffect(() => {
    void refetch()
  }, [refetch, fromMs, toMs, memberId, patientId, status])

  // Cleanup AbortController au unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // Polling interval avec pause sur onglet background (Fix M-1).
  useEffect(() => {
    if (refreshInterval <= 0 || skip || scopeMissing) return
    let id: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (id !== null) return
      id = setInterval(() => {
        void refetch()
      }, refreshInterval)
    }
    const stop = () => {
      if (id !== null) {
        clearInterval(id)
        id = null
      }
    }
    const onVisibilityChange = () => {
      if (typeof document === "undefined") return
      if (document.hidden) stop()
      else start()
    }
    if (typeof document !== "undefined" && !document.hidden) start()
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange)
    }
    return () => {
      stop()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange)
      }
    }
  }, [refetch, refreshInterval, skip, scopeMissing])

  return { items, truncated, loading, isInitialLoading, error, lastFetchedAt, refetch }
}
