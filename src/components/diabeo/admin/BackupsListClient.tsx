"use client"

/**
 * BackupsListClient — UI US-2151 Admin gestion backups (ADMIN-only).
 *
 * Backend : `backupService.list/trigger` (PR #409). Pas de restore exposé
 * iter 2 (procédure ops manuelle via runbook).
 *
 * Fixes round 1 review PR #458 :
 *   - H1 : `setTimeout` reset success tracké via ref (régression M8 PR #457)
 *   - M1 : types extraits dans `src/lib/types/admin-ops.ts`
 *   - M2 : `<StatusIcon kind="backup">` partagé (admin/StatusIcon.tsx)
 *   - M3 : mapping backend error codes UI (backup_already_in_progress / generic)
 *   - M5 : DTO retire `location` (HSA) — `hasLocation` flag à la place
 *   - M7 : `title={backup.backupRef}` tooltip full UUID (A11y M1)
 *   - M8 : `Intl.NumberFormat` dynamic locale (dates via formatDate)
 *   - L1 : helpers `formatBytes`/`formatDuration` documentés (Intl gigabyte
 *     unit fallback navigateur < unit support → preserve custom helper)
 *   - L7 : clear filter button si filterStatus ≠ all
 *   - A11y M3 : errorMessage long via <details>/<summary> expandable
 *   - A11y L1 : statut affiché Capitalize (Pending) vs UPPERCASE
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale } from "next-intl"
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  Plus,
  RefreshCw,
  X,
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
import {
  type BackupStatus,
  type BackupLogDTOClient as BackupLogDTO,
  BACKUP_STATUS_LABELS_FR,
  BACKUP_STATUS_VARIANT,
} from "@/lib/types/admin-ops"
import { StatusIcon } from "./StatusIcon"

type AsyncState = "idle" | "loading" | "success" | "error"

/**
 * Fix M3 round 1 review PR #458 — mapping codes erreur backend → message
 * UI lisible. Codes connus backendService.trigger (PR #409 + future).
 */
const BACKUP_TRIGGER_ERROR_LABELS: Record<string, string> = {
  backup_already_in_progress: "Un backup est déjà en cours. Réessayer plus tard.",
  worker_unreachable: "Worker backup indisponible. Contacter l'équipe ops.",
  disk_full: "Espace disque insuffisant sur le serveur backup.",
}

/**
 * Fix L1 round 1 review PR #458 — formatBytes custom (Intl.NumberFormat
 * `style: "unit", unit: "gigabyte"` n'est pas supporté de manière fiable
 * sur tous les navigateurs pour les unités sub-GB). Locale-aware via
 * Intl.NumberFormat pour le nombre, suffix unit en suffixe textuel.
 */
function formatBytes(bytes: number | null, locale: Locale): string {
  if (bytes === null || bytes === 0) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = bytes
  let unitIdx = 0
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024
    unitIdx++
  }
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unitIdx === 0 ? 0 : 1,
  })
  return `${formatter.format(size)} ${units[unitIdx]}`
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.floor((ms % 60_000) / 1000)} s`
}

/**
 * Fix A11y L1 round 1 — Status badge Capitalize au lieu UPPERCASE
 * (WCAG 1.4.8 AAA lisibilité — capitales plus dures à lire).
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
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
  // Fix H1 round 1 review PR #458 (régression M8 PR #457) — tracking ref
  // pour setTimeout success reset + cleanup au unmount (anti memory leak).
  const triggerResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBackups()
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
      // Fix H1 round 1 — cleanup timer reset au unmount.
      if (triggerResetTimerRef.current) clearTimeout(triggerResetTimerRef.current)
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
      if (!res.ok) {
        setTriggerState("error")
        // Fix M3 round 1 — parse body pour récupérer error code backend.
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        const code = data?.error
        const friendly = code ? BACKUP_TRIGGER_ERROR_LABELS[code] : undefined
        setTriggerError(friendly ?? `Erreur backend (HTTP ${res.status})`)
        return
      }
      setTriggerState("success")
      await fetchBackups()
      // Fix H1 round 1 — timer tracké pour cleanup au unmount.
      if (triggerResetTimerRef.current) clearTimeout(triggerResetTimerRef.current)
      triggerResetTimerRef.current = setTimeout(() => {
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
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">Statut :</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as BackupStatus | "all")}
              className="rounded-md border bg-background px-2 py-1 text-sm"
              aria-label="Filtrer par statut backup"
            >
              <option value="all">Tous</option>
              {Object.entries(BACKUP_STATUS_LABELS_FR).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {/* Fix L7 round 1 — bouton clear filter si actif. */}
          {filterStatus !== "all" && (
            <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => setFilterStatus("all")} aria-label="Effacer le filtre">
              <X className="size-3.5" aria-hidden="true" />
            </DiabeoButton>
          )}
        </div>
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
                <StatusIcon
                  kind="backup"
                  status={backup.status}
                  className="size-5 text-muted-foreground shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Fix M7 + A11y M1 round 1 — title tooltip full backupRef. */}
                    <code
                      className="text-xs font-mono"
                      title={`Référence backup : ${backup.backupRef}`}
                    >
                      {backup.backupRef.slice(0, 12)}…
                    </code>
                    {/* Fix A11y L1 round 1 — Capitalize au lieu de UPPERCASE. */}
                    <Badge variant={BACKUP_STATUS_VARIANT[backup.status]} className="text-[10px]">
                      {capitalize(BACKUP_STATUS_LABELS_FR[backup.status])}
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
                        {formatBytes(backup.sizeBytes, locale)}
                      </span>
                    )}
                    {backup.triggeredBy !== null && (
                      // TODO V2 (Issue #456) — remplacer User #ID séquentiel par
                      // staff.publicRef UUID opaque (anti-énumération).
                      <span>Par User #{backup.triggeredBy}</span>
                    )}
                  </div>
                  {backup.errorMessage && (
                    // Fix A11y M3 round 1 — expandable details (vs overflow horizontal).
                    <details className="text-xs text-destructive mt-1.5">
                      <summary className="cursor-pointer font-medium">⚠ Voir l&apos;erreur</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-destructive/5 p-2 max-h-32 overflow-auto">
                        {backup.errorMessage}
                      </pre>
                    </details>
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
