"use client"

/**
 * US-2634 — Contexte de la fiche patient : **période d'analyse** partagée entre
 * onglets (1 sem / 2 sem / 1 mois / 3 mois) + **transport analytique injecté**.
 *
 * Le composant présentational `<PatientRecord>` ne connaît NI l'id patient NI le
 * jeton : il appelle `fetchAnalytics(endpoint, { period })`, et l'adaptateur de
 * transport (page = `?patientId=` + `canAccessPatient` ; drawer = en-tête
 * `x-consultation-token`) résout l'accès. Garantit l'anti-énumération (le
 * composant unifié ne construit jamais d'URL portant un id patient numérique).
 *
 * Amorce RSC conservée : la fiche est rendue côté serveur sur 14 j ; le re-fetch
 * client n'a lieu QUE si la période diffère de l'amorce (`seedPeriod`).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

/** Périodes supportées (cf. `analyticsService.parsePeriod` — 7/14/30/90 j). */
export type RecordPeriod = "7d" | "14d" | "30d" | "90d"
export const RECORD_PERIODS: readonly RecordPeriod[] = ["7d", "14d", "30d", "90d"] as const

/** Clé i18n du libellé court de chaque période (namespace `patientDetail`).
 * Source unique partagée par le sélecteur et les libellés de KPI (cohérence). */
export const PERIOD_LABEL_KEY: Record<RecordPeriod, string> = {
  "7d": "period7d",
  "14d": "period14d",
  "30d": "period30d",
  "90d": "period90d",
}

/** Délai de debounce des re-fetch (collapse des clics rapides — AC-2). */
const DEBOUNCE_MS = 250

/**
 * Transport injecté par l'adaptateur. Le composant fournit l'endpoint analytique
 * (sans identité) + des paramètres ; l'adaptateur ajoute l'identité (id en query
 * pour la page, jeton en en-tête pour le drawer) et les options de crédential.
 */
export type AnalyticsFetcher = (
  endpoint: string,
  params: Record<string, string>,
  init?: { signal?: AbortSignal },
) => Promise<Response>

interface PatientRecordContextValue {
  period: RecordPeriod
  setPeriod: (p: RecordPeriod) => void
  fetchAnalytics: AnalyticsFetcher
  /** Période de l'amorce serveur (pas de re-fetch tant que `period` y est égal). */
  seedPeriod: RecordPeriod
}

const Ctx = createContext<PatientRecordContextValue | null>(null)

/** `null` si rendu hors provider (ex. tests legacy, états sans données). */
export function usePatientRecordContext(): PatientRecordContextValue | null {
  return useContext(Ctx)
}

export function PatientRecordProvider({
  fetchAnalytics,
  seedPeriod = "14d",
  children,
}: {
  fetchAnalytics: AnalyticsFetcher
  seedPeriod?: RecordPeriod
  children: React.ReactNode
}) {
  const [period, setPeriod] = useState<RecordPeriod>(seedPeriod)
  const value = useMemo<PatientRecordContextValue>(
    () => ({ period, setPeriod, fetchAnalytics, seedPeriod }),
    [period, fetchAnalytics, seedPeriod],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Re-fetch analytique piloté par la période courante. Renvoie l'amorce serveur
 * (`seed`) tant que `period === seedPeriod` ou hors provider — aucun fetch, pas
 * de flicker (AC-2). Sinon : debounce → fetch abortable → `map` du retour brut.
 * En erreur, retombe sur l'amorce (le seed reste un repère valide).
 */
export function usePeriodAnalytics<T>(args: {
  seed: T
  endpoint: string
  map: (raw: unknown) => T
}): { value: T; loading: boolean; error: boolean } {
  const { seed, endpoint } = args
  const ctx = usePatientRecordContext()
  const period = ctx?.period ?? "14d"
  const seedPeriod = ctx?.seedPeriod ?? "14d"
  const atSeed = !ctx || period === seedPeriod

  const [state, setState] = useState<{ value: T; loading: boolean; error: boolean }>({
    value: seed, loading: false, error: false,
  })

  // Refs : `map`/`seed` sont des closures recréées à chaque rendu — les garder
  // hors des deps du fetch évite une boucle de re-fetch. Synchronisées via un
  // effet (mise à jour de ref interdite pendant le rendu) déclaré AVANT le fetch
  // pour qu'il lise toujours les dernières valeurs.
  const mapRef = useRef(args.map)
  const seedRef = useRef(seed)
  useEffect(() => {
    mapRef.current = args.map
    seedRef.current = seed
  })

  useEffect(() => {
    if (atSeed || !ctx) {
      setState({ value: seedRef.current, loading: false, error: false })
      return
    }
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: false }))
    const timer = setTimeout(() => {
      ctx
        .fetchAnalytics(endpoint, { period }, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json() as Promise<unknown>
        })
        .then((raw) => setState({ value: mapRef.current(raw), loading: false, error: false }))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return
          setState({ value: seedRef.current, loading: false, error: true })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [ctx, period, atSeed, endpoint])

  return state
}

/**
 * Construit un `AnalyticsFetcher` pour le **mode page** : id patient en query
 * (`?patientId=`, le scope est résolu serveur via `canAccessPatient`). L'id est
 * fourni par l'adaptateur page (qui le connaît déjà via l'URL de la page), pas
 * par le composant unifié.
 */
export function usePagePatientFetcher(patientId: number): AnalyticsFetcher {
  return useCallback<AnalyticsFetcher>(
    (endpoint, params, init) => {
      const qs = new URLSearchParams({ ...params, patientId: String(patientId) })
      return fetch(`${endpoint}?${qs.toString()}`, {
        credentials: "same-origin",
        signal: init?.signal,
      })
    },
    [patientId],
  )
}
