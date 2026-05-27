"use client"

/**
 * BackupsListClient — UI US-2151 Admin gestion backups (ADMIN-only).
 *
 * Liste backups + filtres status + bouton "Déclencher backup" (POST).
 * Le worker externe (cron) consomme les rows pending. UI affiche state +
 * permet de relancer si pending stuck.
 *
 * Backend : `backupService.list/trigger` (PR #409). Pas de restore exposé
 * iter 2 (procédure ops manuelle documentée runbook).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale } from "next-intl"
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDate } from "@/lib/intl/formatters"
import type { Locale } from "@/i18n/config"

type BackupStatus = "pending" | "running" | "completed" | "failed"

interface BackupLogDTO {
  id: number
  backupRef: string
  status: BackupStatus
  location: string | null
  sizeBytes: number | null // BigInt sérialisé number
  durationMs: number | null
  triggeredBy: number | null
  startedAt: string // ISO
  completedAt: string | null
  errorMessage: string | null
}

type AsyncState = "idle" | "loading" | "success" | "error"

const STATUS_LABELS: Record<BackupStatus, string> = {
  pending: "En attente",
  running: "En cours",
  completed: "Terminé",
  failed: "Échoué",
}

const STATUS_VARIANT: Record<BackupStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  running: "outline",
  completed: "default",
  failed: "destructive",
}

function StatusIcon({ status, className }: { status: BackupStatus; className?: string }) {
  if (status === "completed") return <CheckCircle2 className={className} aria-hidden="true" />
  if (status === "running") return <Loader2 className={`${className ?? ""} animate-spin`} aria-hidden="true" />
  if (status === "failed") return <XCircle className={className} aria-hidden="true" />
  return <Clock className={className} aria-hidden="true" />
}

/**
 * Formate sizeBytes en KB/MB/GB lisible.
 */
function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = bytes
  let unitIdx = 0
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024
    unitIdx++
  }
  return `${size.toFixed(unitIdx === 0 ? 0 : 1)} ${units[unitIdx]}`
}

/**
 * Formate durationMs en secondes/minutes.
 */
function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.floor((ms % 60_000) / 1000)} s`
}

export function BackupsListClient() {
  const locale = useLocale() as Locale
  const [backups, setBackups] = useState<BackupLogDTO[]>([])
  const [state, setState] = useState<AsyncState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<BackupStatus | "all">("all")
  const [showTriggerConfirm, setShowTriggerConfirm] = useState(false)
  const [triggerState, setTriggerState] = useState<AsyncState>("idle")
  const [triggerError, setTriggerError] = useState<string | null>(null)

  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const fetchSeqRef = useRef(0)

  const fetchBackups = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++fetchSeqRef.current
    setState("loading")
    setErrorMessage(null)
    try {
      const params = new URLSearchParams()
      if (filterStatus !== "all") params.set("status", filterStatus)
      const url = `/api/admin/backups${params.toString() ? `?${params.toString()}` : ""}`
      const res = await fetch(url, { credentials: "include", signal: controller.signal })
      if (seq !== fetchSeqRef.current || !mountedRef.current) return
      if (!res.ok) {
        setState("error")
        setErrorMessage(`HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { items?: BackupLogDTO[]; nextCursor?: number }
      if (seq !== fetchSeqRef.current || !mountedRef.current) return
      setBackups(data.items ?? [])
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (seq !== fetchSeqRef.current || !mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [filterStatus])

  useEffect(() => {
    mountedRef.current = true
    // fetchBackups recapture filterStatus via useCallback — re-triggered au
    // changement de filtre. AbortController + fetchSeq gèrent race condition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBackups()
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchBackups])

  const executeTrigger = useCallback(async () => {
    setShowTriggerConfirm(false)
    setTriggerState("loading")
    setTriggerError(null)
    try {
      const res = await fetch("/api/admin/backups", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      })
      if (!mountedRef.current) return
      if (res.status === 409) {
        setTriggerState("error")
        setTriggerError("Un backup est déjà en cours. Réessayer plus tard.")
        return
      }
      if (!res.ok) {
        setTriggerState("error")
        setTriggerError(`HTTP ${res.status}`)
        return
      }
      setTriggerState("success")
      await fetchBackups()
      // Reset state success après 3s.
      setTimeout(() => {
        if (mountedRef.current) setTriggerState("idle")
      }, 3000)
    } catch (err) {
      if (!mountedRef.current) return
      setTriggerState("error")
      setTriggerError(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [fetchBackups])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">Statut :</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as BackupStatus | "all")}
            className="rounded-md border bg-background px-2 py-1 text-sm"
            aria-label="Filtrer par statut backup"
          >
            <option value="all">Tous</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchBackups()}>
            <RefreshCw className="size-3.5 mr-1" aria-hidden="true" />
            Actualiser
          </DiabeoButton>
          <DiabeoButton onClick={() => setShowTriggerConfirm(true)} disabled={triggerState === "loading"}>
            <Plus className="size-4 mr-1" aria-hidden="true" />
            Déclencher backup
          </DiabeoButton>
        </div>
      </div>

      {triggerState === "error" && triggerError && (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
          <p className="text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            {triggerError}
          </p>
        </div>
      )}

      {triggerState === "success" && (
        <div role="status" aria-live="polite" className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
          <p className="flex items-center gap-2 text-primary">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Backup déclenché (status: pending). Le worker le consommera bientôt.
          </p>
        </div>
      )}

      {state === "loading" && backups.length === 0 && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Chargement…
        </p>
      )}

      {state === "error" && backups.length === 0 && (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            Liste indisponible
          </p>
          {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchBackups()} className="mt-2">
            Réessayer
          </DiabeoButton>
        </div>
      )}

      {state === "success" && backups.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <HardDrive className="size-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Aucun backup enregistré.</p>
        </div>
      )}

      {backups.length > 0 && (
        <ul className="space-y-2" aria-label="Liste des backups">
          {backups.map((backup) => (
            <li
              key={backup.id}
              className={`rounded-md border p-3 ${
                backup.status === "failed" ? "border-destructive/40 bg-destructive/5" : "border-border"
              }`}
            >
              <div className="flex items-start gap-3">
                <StatusIcon status={backup.status} className="size-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs font-mono">{backup.backupRef.slice(0, 12)}…</code>
                    <Badge variant={STATUS_VARIANT[backup.status]} className="text-[10px]">
                      {STATUS_LABELS[backup.status]}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" aria-hidden="true" />
                      Démarré {formatDate(backup.startedAt, locale, { withTime: true })}
                    </span>
                    {backup.completedAt && (
                      <span>Durée : {formatDuration(backup.durationMs)}</span>
                    )}
                    {backup.sizeBytes !== null && (
                      <span className="flex items-center gap-1">
                        <Database className="size-3" aria-hidden="true" />
                        {formatBytes(backup.sizeBytes)}
                      </span>
                    )}
                    {backup.triggeredBy !== null && (
                      <span>Par User #{backup.triggeredBy}</span>
                    )}
                  </div>
                  {backup.errorMessage && (
                    <p className="text-xs text-destructive mt-1">⚠ {backup.errorMessage}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Confirmation déclenchement backup (Dialog shadcn — focus trap + ESC). */}
      <Dialog open={showTriggerConfirm} onOpenChange={(open) => { if (!open) setShowTriggerConfirm(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Déclencher un backup PostgreSQL ?</DialogTitle>
            <DialogDescription>
              Le backup démarrera immédiatement (status: pending → running). Durée
              estimée : 2-15 minutes selon taille DB. L&apos;opération est tracée
              dans le journal d&apos;audit.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton variant="diabeoTertiary" onClick={() => setShowTriggerConfirm(false)}>
              Annuler
            </DiabeoButton>
            <DiabeoButton onClick={() => void executeTrigger()}>
              Déclencher
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
