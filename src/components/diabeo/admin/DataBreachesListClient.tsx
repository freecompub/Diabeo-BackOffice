"use client"

/**
 * DataBreachesListClient — UI US-2137 Notification violation CNIL (RGPD Art. 33).
 *
 * Affiche la liste des violations déclarées + filtres status/severity +
 * bouton "Déclarer une violation" qui ouvre dialog de création.
 *
 * Backend : `dataBreachService` (PR #409 Groupe 9 Admin/Ops).
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, AlertTriangle, Clock, Plus, ShieldAlert } from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"

type DataBreachSeverity = "low" | "medium" | "high" | "critical"
type DataBreachStatus =
  | "draft"
  | "under_assessment"
  | "notified_cnil"
  | "notified_users"
  | "closed"

interface DataBreachDTO {
  id: number
  severity: DataBreachSeverity
  status: DataBreachStatus
  title: string
  description: string | null
  remediation: string | null
  cnilCaseNumber: string | null
  usersNotifiedCount: number
  detectedAt: string // ISO
  declaredBy: number | null
  cnilNotifiedAt: string | null
  usersNotifiedAt: string | null
  closedAt: string | null
  cnilDeadlineHoursRemaining: number | null
  cnilDeadlineExceeded: boolean
}

type AsyncState = "idle" | "loading" | "success" | "error"

const SEVERITY_LABELS: Record<DataBreachSeverity, string> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  critical: "Critique",
}

const SEVERITY_VARIANT: Record<DataBreachSeverity, "default" | "secondary" | "destructive" | "outline"> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  critical: "destructive",
}

const STATUS_LABELS: Record<DataBreachStatus, string> = {
  draft: "Brouillon",
  under_assessment: "En évaluation",
  notified_cnil: "Notifié CNIL",
  notified_users: "Utilisateurs notifiés",
  closed: "Clos",
}

export function DataBreachesListClient() {
  const [breaches, setBreaches] = useState<DataBreachDTO[]>([])
  const [state, setState] = useState<AsyncState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<DataBreachStatus | "all">("all")
  const [filterSeverity, setFilterSeverity] = useState<DataBreachSeverity | "all">("all")
  const [showDeclareDialog, setShowDeclareDialog] = useState(false)

  const fetchBreaches = useCallback(async () => {
    setState("loading")
    setErrorMessage(null)
    try {
      const params = new URLSearchParams()
      if (filterStatus !== "all") params.set("status", filterStatus)
      if (filterSeverity !== "all") params.set("severity", filterSeverity)
      const url = `/api/admin/data-breaches${params.toString() ? `?${params.toString()}` : ""}`
      const res = await fetch(url, { credentials: "include" })
      if (!res.ok) {
        setState("error")
        setErrorMessage(`HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { items?: DataBreachDTO[] }
      setBreaches(data.items ?? [])
      setState("success")
    } catch (err) {
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [filterStatus, filterSeverity])

  useEffect(() => {
    // fetchBreaches est intentionally re-triggered au changement de
    // filterStatus/filterSeverity (le useCallback recapture les filtres pour
    // la query URL). Pattern aligné avec autres clients admin du projet —
    // alternative SWR/react-query reportée V2.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBreaches()
  }, [fetchBreaches])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">Statut :</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as DataBreachStatus | "all")}
              className="rounded-md border bg-background px-2 py-1 text-sm"
              aria-label="Filtrer par statut"
            >
              <option value="all">Tous</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">Sévérité :</span>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value as DataBreachSeverity | "all")}
              className="rounded-md border bg-background px-2 py-1 text-sm"
              aria-label="Filtrer par sévérité"
            >
              <option value="all">Toutes</option>
              {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DiabeoButton onClick={() => setShowDeclareDialog(true)}>
          <Plus className="size-4 mr-1" aria-hidden="true" />
          Déclarer une violation
        </DiabeoButton>
      </div>

      {state === "loading" && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Chargement…
        </p>
      )}

      {state === "error" && (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            Impossible de charger les violations
          </p>
          {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchBreaches()} className="mt-2">
            Réessayer
          </DiabeoButton>
        </div>
      )}

      {state === "success" && breaches.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <ShieldAlert className="size-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Aucune violation enregistrée.</p>
        </div>
      )}

      {state === "success" && breaches.length > 0 && (
        <ul className="space-y-2" aria-label="Liste des violations">
          {breaches.map((breach) => (
            <li
              key={breach.id}
              className={`rounded-md border p-3 ${
                breach.cnilDeadlineExceeded
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border"
              }`}
            >
              <Link
                href={`/admin/data-breaches/${breach.id}`}
                className="block hover:bg-muted/30 -m-3 p-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{breach.title}</span>
                      <Badge variant={SEVERITY_VARIANT[breach.severity]} className="text-[10px]">
                        {SEVERITY_LABELS[breach.severity]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {STATUS_LABELS[breach.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Détectée le {new Date(breach.detectedAt).toLocaleString("fr-FR")}
                    </p>
                    {breach.cnilDeadlineHoursRemaining !== null && breach.status !== "notified_cnil" && breach.status !== "notified_users" && breach.status !== "closed" && (
                      <p
                        className={`text-xs mt-1 flex items-center gap-1 ${
                          breach.cnilDeadlineExceeded
                            ? "text-destructive font-semibold"
                            : breach.cnilDeadlineHoursRemaining < 12
                            ? "text-orange-600 font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {breach.cnilDeadlineExceeded ? (
                          <AlertTriangle className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Clock className="size-3.5" aria-hidden="true" />
                        )}
                        {breach.cnilDeadlineExceeded
                          ? "Délai CNIL 72h dépassé"
                          : `Délai CNIL : ${breach.cnilDeadlineHoursRemaining}h restantes`}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {showDeclareDialog && (
        <DeclareDialog
          onClose={() => setShowDeclareDialog(false)}
          onCreated={() => {
            setShowDeclareDialog(false)
            void fetchBreaches()
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// DeclareDialog — minimal create form
// ---------------------------------------------------------------------------

function DeclareDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [severity, setSeverity] = useState<DataBreachSeverity>("medium")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitState, setSubmitState] = useState<AsyncState>("idle")
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (title.trim().length === 0) return
      setSubmitState("loading")
      setSubmitError(null)
      try {
        const res = await fetch("/api/admin/data-breaches", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({
            severity,
            title: title.trim(),
            description: description.trim() || undefined,
          }),
        })
        if (res.ok) {
          onCreated()
        } else {
          setSubmitState("error")
          const data = (await res.json().catch(() => null)) as { error?: string } | null
          setSubmitError(data?.error ?? `HTTP ${res.status}`)
        }
      } catch (err) {
        setSubmitState("error")
        setSubmitError(err instanceof Error ? err.message : "Erreur réseau")
      }
    },
    [severity, title, description, onCreated],
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="declare-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg flex flex-col gap-4"
      >
        <header>
          <h2 id="declare-dialog-title" className="text-lg font-semibold">
            Déclarer une violation de données
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            ⚠️ NE PAS INCLURE de PHI/PII dans le titre (anti-fuite audit logs).
          </p>
        </header>

        <label className="flex flex-col gap-1 text-sm">
          <span>Sévérité</span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as DataBreachSeverity)}
            className="rounded-md border bg-background px-3 py-2"
            required
          >
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>
            Titre <span className="text-destructive">*</span>
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Fuite tokens FCM cabinet X (sans détails identifiants)"
            className="rounded-md border bg-background px-3 py-2"
            required
            maxLength={200}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>Description (optionnel)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Détails techniques de la violation (chiffré en base)"
            className="rounded-md border bg-background px-3 py-2 min-h-[80px]"
            maxLength={5000}
          />
        </label>

        {submitState === "error" && submitError && (
          <p role="alert" className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            Erreur : {submitError}
          </p>
        )}

        <footer className="flex justify-end gap-2 pt-2">
          <DiabeoButton type="button" variant="diabeoTertiary" onClick={onClose}>
            Annuler
          </DiabeoButton>
          <DiabeoButton
            type="submit"
            disabled={submitState === "loading" || title.trim().length === 0}
          >
            {submitState === "loading" ? "Création…" : "Déclarer (status=brouillon)"}
          </DiabeoButton>
        </footer>
      </form>
    </div>
  )
}

