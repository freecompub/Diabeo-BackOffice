"use client"

/**
 * SystemHealthClient — UI US-2150 Dashboard santé système (ADMIN-only).
 *
 * Affiche : statut global + 4 composants (DB, Redis, CGM lag, Backups) +
 * métriques (sessions actives, tentatives non-autorisées 24h, CGM lag, age
 * dernier backup).
 *
 * Backend : `GET /api/admin/system-health` (PR #409). Refresh auto 60s.
 *
 * Pattern aligné PR #457 iter 1 (Sessions/DataBreaches) : AbortController +
 * mountedRef + error feedback + i18n via next-intl.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale } from "next-intl"
import {
  AlertCircle,
  Activity,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  HelpCircle,
  RefreshCw,
  ShieldAlert,
  Users,
  XCircle,
  Zap,
} from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import { formatRelativeTime } from "@/lib/intl/formatters"
import type { Locale } from "@/i18n/config"

type ComponentStatus = "ok" | "degraded" | "down" | "unknown"
type OverallStatus = "ok" | "degraded" | "down"

interface SystemHealthDTO {
  status: OverallStatus
  components: {
    db: ComponentStatus
    redis: ComponentStatus
    cgmIngestion: ComponentStatus
    backups: ComponentStatus
  }
  metrics: {
    activeSessions: number
    unauthorizedAttempts24h: number
    cgmLagMinutes: number | null
    lastBackupAgeHours: number | null
  }
  checkedAt: string // ISO
}

type AsyncState = "idle" | "loading" | "success" | "error"
const REFRESH_INTERVAL_MS = 60_000

const STATUS_LABELS: Record<ComponentStatus, string> = {
  ok: "OK",
  degraded: "Dégradé",
  down: "HS",
  unknown: "Inconnu",
}

const STATUS_VARIANT: Record<ComponentStatus, "default" | "secondary" | "destructive" | "outline"> = {
  ok: "default",
  degraded: "outline",
  down: "destructive",
  unknown: "secondary",
}

function StatusIcon({ status, className }: { status: ComponentStatus; className?: string }) {
  if (status === "ok") return <CheckCircle2 className={className} aria-hidden="true" />
  if (status === "degraded") return <AlertCircle className={className} aria-hidden="true" />
  if (status === "down") return <XCircle className={className} aria-hidden="true" />
  return <HelpCircle className={className} aria-hidden="true" />
}

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
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  useEffect(() => {
    mountedRef.current = true
    // Initial fetch + auto-refresh 60s. Pattern aligné PR #457 iter 1.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSnapshot()
    refreshTimerRef.current = setInterval(() => {
      void fetchSnapshot()
    }, REFRESH_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
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

  const overallVariant: "default" | "outline" | "destructive" =
    snapshot.status === "ok" ? "default" : snapshot.status === "degraded" ? "outline" : "destructive"

  return (
    <>
      {/* Statut global + refresh manuel */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
        <div className="flex items-center gap-3">
          <StatusIcon
            status={snapshot.status === "ok" ? "ok" : snapshot.status === "degraded" ? "degraded" : "down"}
            className="size-8"
          />
          <div>
            <p className="text-sm text-muted-foreground">Statut global</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold">
                {snapshot.status === "ok" ? "Opérationnel" : snapshot.status === "degraded" ? "Dégradé" : "Hors service"}
              </span>
              <Badge variant={overallVariant}>{snapshot.status.toUpperCase()}</Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            Dernière vérification {formatRelativeTime(snapshot.checkedAt, locale)}
          </p>
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchSnapshot()}>
            <RefreshCw className="size-3.5 mr-1" aria-hidden="true" />
            Actualiser
          </DiabeoButton>
        </div>
      </section>

      {/* Composants */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Composants système">
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
                      <Badge variant={STATUS_VARIANT[status]} className="text-[10px]">
                        {STATUS_LABELS[status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
                  </div>
                </div>
              </div>
            )
          },
        )}
      </section>

      {/* Métriques */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Métriques">
        <MetricCard
          icon={Users}
          label="Sessions actives"
          value={snapshot.metrics.activeSessions.toLocaleString("fr-FR")}
        />
        <MetricCard
          icon={ShieldAlert}
          label="Tentatives non-autorisées 24h"
          value={snapshot.metrics.unauthorizedAttempts24h.toLocaleString("fr-FR")}
          highlight={snapshot.metrics.unauthorizedAttempts24h > 100}
        />
        <MetricCard
          icon={Activity}
          label="CGM lag (minutes)"
          value={snapshot.metrics.cgmLagMinutes !== null ? `${snapshot.metrics.cgmLagMinutes} min` : "—"}
          highlight={(snapshot.metrics.cgmLagMinutes ?? 0) > 30}
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
        />
      </section>
    </>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  highlight = false,
}: {
  icon: typeof Database
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        highlight ? "border-orange-300 bg-orange-50" : "border-border"
      }`}
    >
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="size-4" aria-hidden="true" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  )
}
