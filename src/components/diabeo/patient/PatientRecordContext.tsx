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

/** Vue des onglets analytiques (US-2636) : agrégat (AGP) vs 1 ligne/jour. */
export type RecordView = "average" | "daily"
export const RECORD_VIEWS: readonly RecordView[] = ["average", "daily"] as const

/** Clé i18n du libellé de chaque vue (namespace `patientDetail`). */
export const VIEW_LABEL_KEY: Record<RecordView, string> = {
  average: "viewAverage",
  daily: "viewDaily",
}

/**
 * Période d'amorce (RSC). **DOIT** rester synchrone avec `OVERVIEW_PERIOD` de
 * `build-patient-record.ts` (projection serveur) : la fiche est rendue sur cette
 * fenêtre côté serveur, aucun re-fetch tant que la période sélectionnée y est
 * égale. Source unique côté client (adaptateurs page/drawer + défaut provider).
 */
export const SEED_PERIOD: RecordPeriod = "14d"

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
  /** Vue analytique partagée (moyenne/AGP vs tableau journalier) — US-2636. */
  view: RecordView
  setView: (v: RecordView) => void
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
  seedPeriod = SEED_PERIOD,
  children,
}: {
  fetchAnalytics: AnalyticsFetcher
  seedPeriod?: RecordPeriod
  children: React.ReactNode
}) {
  const [period, setPeriod] = useState<RecordPeriod>(seedPeriod)
  const [view, setView] = useState<RecordView>("average")
  const value = useMemo<PatientRecordContextValue>(
    () => ({ period, setPeriod, view, setView, fetchAnalytics, seedPeriod }),
    [period, view, fetchAnalytics, seedPeriod],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export interface PeriodAnalyticsState<T> {
  value: T
  loading: boolean
  error: boolean
  /**
   * Période à laquelle correspond RÉELLEMENT `value` (≠ période demandée pendant
   * un chargement ou après une erreur). L'appelant DOIT libeller la donnée avec
   * CETTE période — jamais la période demandée — pour ne jamais afficher une
   * fenêtre sous le libellé d'une autre (sécurité clinique, revue #610).
   */
  valuePeriod: RecordPeriod
}

/**
 * Re-fetch analytique piloté par la période courante. Renvoie l'amorce serveur
 * (`seed`, `valuePeriod = seedPeriod`) tant que `period === seedPeriod` ou hors
 * provider — aucun fetch, pas de flicker (AC-2). Sinon : debounce → fetch
 * abortable → `map` du retour brut (`valuePeriod = période demandée`). En
 * erreur : retombe sur l'amorce ET `valuePeriod = seedPeriod` (la donnée
 * affichée reste étiquetable correctement) + `error = true`.
 */
export function usePeriodAnalytics<T>(args: {
  seed: T
  endpoint: string
  map: (raw: unknown) => T
  /**
   * `false` neutralise le re-fetch (reste sur l'amorce). Sert au fail-closed
   * US-2638 : ne PAS interroger l'endpoint CGM pour un patient BGM (fetch +
   * audit `READ ANALYTICS` superflus). Défaut : `true`.
   */
  enabled?: boolean
}): PeriodAnalyticsState<T> {
  const { seed, endpoint, enabled = true } = args
  const ctx = usePatientRecordContext()
  const period = ctx?.period ?? SEED_PERIOD
  const seedPeriod = ctx?.seedPeriod ?? SEED_PERIOD
  const atSeed = !ctx || period === seedPeriod || !enabled

  const [state, setState] = useState<PeriodAnalyticsState<T>>({
    value: seed, loading: false, error: false, valuePeriod: seedPeriod,
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
      setState({ value: seedRef.current, loading: false, error: false, valuePeriod: seedPeriod })
      return
    }
    const ctrl = new AbortController()
    // Chargement : on conserve `valuePeriod` précédent (la donnée affichée reste
    // celle d'avant, correctement étiquetée) — pas de flicker.
    setState((s) => ({ ...s, loading: true, error: false }))
    const timer = setTimeout(() => {
      ctx
        .fetchAnalytics(endpoint, { period }, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json() as Promise<unknown>
        })
        .then((raw) =>
          setState({ value: mapRef.current(raw), loading: false, error: false, valuePeriod: period }),
        )
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return
          // Échec : on retombe sur l'amorce ET on ré-étiquette la donnée à
          // `seedPeriod` (jamais des stats d'amorce sous le libellé demandé).
          setState({ value: seedRef.current, loading: false, error: true, valuePeriod: seedPeriod })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [ctx, period, atSeed, seedPeriod, endpoint])

  return state
}

export interface PeriodResourceState<T> {
  data: T | null
  loading: boolean
  error: boolean
  /** Période à laquelle correspond `data` (null tant qu'aucun succès). L'appelant
   * DOIT libeller la donnée avec CETTE période (cohérence donnée/étiquette). */
  valuePeriod: RecordPeriod | null
}

/**
 * Re-fetch analytique **sans amorce serveur** (onglets lazy : AGP, tableau
 * journalier…), piloté par la période. Fetch au montage ET à chaque changement
 * de période (debounced, abortable). Contrairement à `usePeriodAnalytics`, aucun
 * `seed` : `data` est `null` jusqu'au premier succès. En erreur, conserve la
 * donnée précédente (peut être `null`) + `error=true` ; `valuePeriod` reste la
 * dernière période chargée avec succès → jamais une donnée sous un mauvais
 * libellé de période.
 */
export function usePeriodResource<T>(args: {
  endpoint: string
  map: (raw: unknown) => T
  /** Paramètre `source` optionnel (ex. `"bgm"`) ajouté à la requête. */
  source?: string
}): PeriodResourceState<T> {
  const { endpoint, source } = args
  const ctx = usePatientRecordContext()
  const period = ctx?.period ?? SEED_PERIOD

  const [state, setState] = useState<PeriodResourceState<T>>({
    data: null, loading: true, error: false, valuePeriod: null,
  })

  const mapRef = useRef(args.map)
  useEffect(() => {
    mapRef.current = args.map
  })

  useEffect(() => {
    // Hors provider (défensif ; inatteignable en pratique — page et drawer
    // montent toujours le Provider) : pas de fetch. Cf. retour statique plus bas.
    if (!ctx) return
    const ctrl = new AbortController()
    // `loading:true` posé dans le timer (après debounce) — évite un setState
    // synchrone en corps d'effet ; l'état initial est déjà `loading:true`.
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true, error: false }))
      ctx
        .fetchAnalytics(endpoint, source ? { period, source } : { period }, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json() as Promise<unknown>
        })
        .then((raw) => setState({ data: mapRef.current(raw), loading: false, error: false, valuePeriod: period }))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return
          setState((s) => ({ data: s.data, loading: false, error: true, valuePeriod: s.valuePeriod }))
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [ctx, period, endpoint, source])

  // Hors provider → état vide stable (sans setState en effet).
  return ctx ? state : { data: null, loading: false, error: false, valuePeriod: null }
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
