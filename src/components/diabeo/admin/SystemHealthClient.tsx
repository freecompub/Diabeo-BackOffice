"use client"

/**
 * SystemHealthClient — UI US-2150 Dashboard santé système (ADMIN-only).
 *
 * Backend : `GET /api/admin/system-health` (PR #409). Auto-refresh 60s
 * (toggle pause utilisateur — Fix C1 round 1 review PR #458 WCAG 2.2.1).
 *
 * Fixes round 1 review PR #458 :
 *   - C1 : bouton pause/reprendre auto-refresh (WCAG 2.2.1 Timing Adjustable)
 *   - C2 : warning text "⚠ Seuil dépassé" + icône (WCAG 1.4.1 color-only)
 *   - H4 : `<h2>` explicite par section (WCAG 1.3.1 hierarchy)
 *   - M1 : types extraits dans `src/lib/types/admin-ops.ts`
 *   - M2 : `<StatusIcon>` partagé (admin/StatusIcon.tsx)
 *   - M6 : `setTimeout` récursif post-fetch (auto-throttle si DB rame)
 *   - M8 : `Intl.NumberFormat(locale)` dynamic (vs toLocaleString("fr-FR"))
 *   - L3 : `OVERALL_STATUS_LABELS_FR[status]` map (vs chained ternary)
 *   - L5 : icône `Heart` conservée (sémantique discussion — Activity alt rejetée)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale } from "next-intl"
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Clock,
  Database,
  HardDrive,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Users,
  Zap,
} from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import { formatRelativeTime } from "@/lib/intl/formatters"
import type { Locale } from "@/i18n/config"
import {
  type ComponentStatus,
  type SystemHealthDTOClient as SystemHealthDTO,
  COMPONENT_STATUS_LABELS_FR,
  COMPONENT_STATUS_VARIANT,
  OVERALL_STATUS_LABELS_FR,
  OVERALL_STATUS_VARIANT,
} from "@/lib/types/admin-ops"
import { StatusIcon } from "./StatusIcon"

type AsyncState = "idle" | "loading" | "success" | "error"
const REFRESH_INTERVAL_MS = 60_000

const COMPONENT_META: Record<
  keyof SystemHealthDTO["components"],
  { label: string; description: string; Icon: typeof Database }
> = {
  db: {
    label: "Base de données",
    description: "PostgreSQL — connexion + ping < 2s",
    Icon: Database,
  },
  redis: {
    label: "Redis (cache)",
    description: "Upstash — disponibilité ping",
    Icon: Zap,
  },
  cgmIngestion: {
    label: "Ingestion CGM",
    description: "Délai dernière donnée capteur reçue",
    Icon: Activity,
  },
  backups: {
    label: "Backups",
    description: "Fraîcheur dernier backup PostgreSQL (< 36h)",
    Icon: HardDrive,
  },
}

export function SystemHealthClient() {
  const locale = useLocale() as Locale
  const [snapshot, setSnapshot] = useState<SystemHealthDTO | null>(null)
  const [state, setState] = useState<AsyncState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // Fix C1 round 1 — pause toggle auto-refresh (WCAG 2.2.1).
  const [isPaused, setIsPaused] = useState(false)
  // Ref miroir pour que `scheduleNextFetch` lise toujours la valeur
  // courante sans recréation au toggle (pattern stable callback React 19).
  const isPausedRef = useRef(false)
  useEffect(() => { isPausedRef.current = isPaused }, [isPaused])
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  // Fix M6 round 1 — setTimeout récursif (vs setInterval qui overlap si fetch > 60s).
  const nextFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fix M8 round 1 — Intl.NumberFormat dynamic locale (vs toLocaleString FR hardcoded).
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale])

  const fetchSnapshot = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState("loading")
    setErrorMessage(null)
    try {
      const res = await fetch("/api/admin/system-health", {
        credentials: "include",
        signal: controller.signal,
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setState("error")
        setErrorMessage(`HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as SystemHealthDTO
      if (!mountedRef.current) return
      setSnapshot(data)
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (!mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [])

  // Fix M6 round 1 — boucle setTimeout récursive interne au useEffect (vs
  // setInterval qui overlap si fetch > 60s + vs useCallback récursif que
  // React 19 lint flag immutability). La boucle vit dans le scope du
  // useEffect ; deps [isPaused, fetchSnapshot] re-monte la loop à chaque
  // pause toggle (acceptable car rare action user).
  //
  // Au mount : initial fetch + loop scheduled si !isPaused.
  // À pause toggle : cleanup + re-mount loop si reprend.
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    const loop = (): void => {
      if (nextFetchTimerRef.current) clearTimeout(nextFetchTimerRef.current)
      if (cancelled || isPausedRef.current) return
      nextFetchTimerRef.current = setTimeout(async () => {
        if (cancelled || !mountedRef.current || isPausedRef.current) return
        await fetchSnapshot()
        loop()
      }, REFRESH_INTERVAL_MS)
    }

    // Initial mount only — fetch + loop. Pause toggle : juste re-schedule.
    if (!isPaused) {
      loop()
    }

    return () => {
      cancelled = true
      if (nextFetchTimerRef.current) clearTimeout(nextFetchTimerRef.current)
    }
  }, [isPaused, fetchSnapshot])

  // Initial mount fetch (séparé du loop pour éviter re-fetch à chaque pause toggle).
  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSnapshot()
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchSnapshot])

  if (state === "loading" && !snapshot) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Chargement du snapshot santé système…
      </p>
    )
  }

  if (state === "error" && !snapshot) {
    return (
      <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3">
        <p className="font-medium text-destructive flex items-center gap-2">
          <AlertCircle className="size-4" aria-hidden="true" />
          Snapshot indisponible
        </p>
        {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
        <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchSnapshot()} className="mt-2">
          Réessayer
        </DiabeoButton>
      </div>
    )
  }

  if (!snapshot) return null

  return (
    <>
      {/* Statut global + refresh manuel + pause toggle */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4" aria-labelledby="health-overall">
        <h2 id="health-overall" className="sr-only">Statut global</h2>
        <div className="flex items-center gap-3">
          <StatusIcon
            kind="component"
            status={snapshot.status === "ok" ? "ok" : snapshot.status === "degraded" ? "degraded" : "down"}
            className="size-8"
          />
          <div>
            <p className="text-sm text-muted-foreground">Statut global</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold">
                {OVERALL_STATUS_LABELS_FR[snapshot.status]}
              </span>
              <Badge variant={OVERALL_STATUS_VARIANT[snapshot.status]}>
                {snapshot.status.toUpperCase()}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            Dernière vérification {formatRelativeTime(snapshot.checkedAt, locale)}
          </p>
          {/* Fix C1 round 1 — bouton pause/reprendre auto-refresh (WCAG 2.2.1). */}
          <DiabeoButton
            variant="diabeoTertiary"
            size="sm"
            onClick={() => setIsPaused((p) => !p)}
            aria-pressed={isPaused}
            aria-label={isPaused ? "Reprendre l'actualisation automatique" : "Mettre en pause l'actualisation automatique"}
          >
            {isPaused ? <Play className="size-3.5 mr-1" aria-hidden="true" /> : <Pause className="size-3.5 mr-1" aria-hidden="true" />}
            {isPaused ? "Reprendre auto" : "Pause auto"}
          </DiabeoButton>
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchSnapshot()}>
            <RefreshCw className="size-3.5 mr-1" aria-hidden="true" />
            Actualiser
          </DiabeoButton>
        </div>
      </section>

      {/* Composants */}
      <section aria-labelledby="health-components" className="space-y-2">
        <h2 id="health-components" className="text-lg font-semibold">Composants</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(Object.entries(snapshot.components) as Array<[keyof SystemHealthDTO["components"], ComponentStatus]>).map(
            ([key, status]) => {
              const meta = COMPONENT_META[key]
              return (
                <div
                  key={key}
                  className={`rounded-md border p-3 ${
                    status === "down" ? "border-destructive/40 bg-destructive/5" : "border-border"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <meta.Icon className="size-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{meta.label}</span>
                        <Badge variant={COMPONENT_STATUS_VARIANT[status]} className="text-[10px]">
                          {COMPONENT_STATUS_LABELS_FR[status]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
                    </div>
                  </div>
                </div>
              )
            },
          )}
        </div>
      </section>

      {/* Métriques */}
      <section aria-labelledby="health-metrics" className="space-y-2">
        <h2 id="health-metrics" className="text-lg font-semibold">Métriques</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            icon={Users}
            label="Sessions actives"
            value={numberFormatter.format(snapshot.metrics.activeSessions)}
          />
          <MetricCard
            icon={ShieldAlert}
            label="Tentatives non-autorisées 24h"
            value={numberFormatter.format(snapshot.metrics.unauthorizedAttempts24h)}
            highlight={snapshot.metrics.unauthorizedAttempts24h > 100}
            highlightReason="Plus de 100 tentatives non-autorisées sur 24h — risque attaque active."
          />
          <MetricCard
            icon={Activity}
            label="CGM lag (minutes)"
            value={snapshot.metrics.cgmLagMinutes !== null ? `${snapshot.metrics.cgmLagMinutes} min` : "—"}
            highlight={(snapshot.metrics.cgmLagMinutes ?? 0) > 30}
            highlightReason="Retard d'ingestion CGM > 30 min — vérifier worker MyDiabby."
          />
          <MetricCard
            icon={Clock}
            label="Dernier backup"
            value={
              snapshot.metrics.lastBackupAgeHours !== null
                ? `il y a ${snapshot.metrics.lastBackupAgeHours}h`
                : "—"
            }
            highlight={(snapshot.metrics.lastBackupAgeHours ?? 0) > 36}
            highlightReason="Dernier backup > 36h — vérifier cron postgres-backup."
          />
        </div>
      </section>
    </>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  highlight = false,
  highlightReason,
}: {
  icon: typeof Database
  label: string
  value: string
  highlight?: boolean
  highlightReason?: string
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        highlight ? "border-orange-300 bg-orange-50" : "border-border"
      }`}
      role={highlight ? "alert" : undefined}
    >
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="size-4" aria-hidden="true" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-xl font-semibold">{value}</p>
      {/* Fix C2 round 1 — warning text+icon explicite (vs color-only WCAG 1.4.1). */}
      {highlight && (
        <p className="mt-1.5 text-xs text-orange-700 flex items-start gap-1">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <span className="sr-only">Alerte : </span>
            Seuil dépassé.
            {highlightReason && <span className="block opacity-80">{highlightReason}</span>}
          </span>
        </p>
      )}
    </div>
  )
}
