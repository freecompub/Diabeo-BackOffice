"use client"

/**
 * DataBreachDetailClient — UI détail violation + workflow FSM.
 *
 * Affiche : titre + severity + status + dates + délai CNIL + champs éditables
 * (description, remediation, cnilCaseNumber) + boutons transition FSM.
 *
 * FSM allowed transitions (data-breach.service ALLOWED_TRANSITIONS) :
 *   draft → under_assessment | closed
 *   under_assessment → notified_cnil | closed
 *   notified_cnil → notified_users | closed
 *   notified_users → closed
 *   closed → (terminal, no transitions)
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, AlertTriangle, ArrowLeft, ChevronRight, Clock, Loader2 } from "lucide-react"
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
  detectedAt: string
  declaredBy: number | null
  cnilNotifiedAt: string | null
  usersNotifiedAt: string | null
  closedAt: string | null
  cnilDeadlineHoursRemaining: number | null
  cnilDeadlineExceeded: boolean
}

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

const ALLOWED_TRANSITIONS: Record<DataBreachStatus, DataBreachStatus[]> = {
  draft: ["under_assessment", "closed"],
  under_assessment: ["notified_cnil", "closed"],
  notified_cnil: ["notified_users", "closed"],
  notified_users: ["closed"],
  closed: [],
}

type AsyncState = "idle" | "loading" | "saving" | "success" | "error"

export function DataBreachDetailClient({ breachId }: { breachId: number }) {
  const [breach, setBreach] = useState<DataBreachDTO | null>(null)
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftDescription, setDraftDescription] = useState("")
  const [draftRemediation, setDraftRemediation] = useState("")
  const [draftCnilCase, setDraftCnilCase] = useState("")
  const [usersNotified, setUsersNotified] = useState<string>("")
  const [transitionPending, setTransitionPending] = useState<DataBreachStatus | null>(null)

  const fetchBreach = useCallback(async () => {
    setState("loading")
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/admin/data-breaches/${breachId}`, { credentials: "include" })
      if (!res.ok) {
        setState("error")
        setErrorMessage(res.status === 404 ? "Violation introuvable" : `HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { breach?: DataBreachDTO }
      if (data.breach) {
        setBreach(data.breach)
        setDraftDescription(data.breach.description ?? "")
        setDraftRemediation(data.breach.remediation ?? "")
        setDraftCnilCase(data.breach.cnilCaseNumber ?? "")
      }
      setState("success")
    } catch (err) {
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [breachId])

  useEffect(() => {
    void fetchBreach()
  }, [fetchBreach])

  const handleSave = useCallback(async () => {
    if (!breach) return
    setState("saving")
    try {
      const res = await fetch(`/api/admin/data-breaches/${breachId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          description: draftDescription.trim() || null,
          remediation: draftRemediation.trim() || null,
          cnilCaseNumber: draftCnilCase.trim() || null,
        }),
      })
      if (res.ok) {
        setEditing(false)
        await fetchBreach()
      } else {
        setState("error")
        setErrorMessage(`HTTP ${res.status}`)
      }
    } catch (err) {
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [breach, breachId, draftDescription, draftRemediation, draftCnilCase, fetchBreach])

  const handleTransition = useCallback(
    async (to: DataBreachStatus) => {
      if (!breach) return
      // Confirmation explicite pour notifications externes (irréversible
      // forensique).
      const needsConfirmation = to === "notified_cnil" || to === "notified_users" || to === "closed"
      if (
        needsConfirmation &&
        !confirm(`Confirmer transition vers "${STATUS_LABELS[to]}" ? Action tracée audit log immuable.`)
      ) {
        return
      }
      if (to === "notified_users") {
        const count = Number.parseInt(usersNotified, 10)
        if (!Number.isFinite(count) || count < 0) {
          alert("Nombre d'utilisateurs notifiés requis (entier ≥ 0)")
          return
        }
      }
      setTransitionPending(to)
      try {
        const body: { to: DataBreachStatus; usersNotifiedCount?: number } = { to }
        if (to === "notified_users") {
          body.usersNotifiedCount = Number.parseInt(usersNotified, 10)
        }
        const res = await fetch(`/api/admin/data-breaches/${breachId}/transition`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify(body),
        })
        if (res.ok) {
          await fetchBreach()
        } else {
          setErrorMessage(`Transition refusée (HTTP ${res.status})`)
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
      } finally {
        setTransitionPending(null)
      }
    },
    [breach, breachId, usersNotified, fetchBreach],
  )

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Chargement…
      </div>
    )
  }

  if (state === "error" || !breach) {
    return (
      <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3">
        <p className="font-medium text-destructive flex items-center gap-2">
          <AlertCircle className="size-4" aria-hidden="true" />
          Erreur de chargement
        </p>
        {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
        <Link
          href="/admin/data-breaches"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Retour à la liste
        </Link>
      </div>
    )
  }

  const allowedTransitions = ALLOWED_TRANSITIONS[breach.status]

  return (
    <>
      <Link
        href="/admin/data-breaches"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Retour à la liste
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{breach.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={SEVERITY_VARIANT[breach.severity]}>
            {SEVERITY_LABELS[breach.severity]}
          </Badge>
          <Badge variant="outline">{STATUS_LABELS[breach.status]}</Badge>
        </div>
      </header>

      {/* Délai CNIL warning */}
      {breach.cnilDeadlineHoursRemaining !== null && breach.status !== "notified_cnil" && breach.status !== "notified_users" && breach.status !== "closed" && (
        <div
          role="alert"
          className={`flex items-start gap-2 rounded-md border p-3 ${
            breach.cnilDeadlineExceeded
              ? "border-destructive/40 bg-destructive/10"
              : breach.cnilDeadlineHoursRemaining < 12
              ? "border-orange-300 bg-orange-50"
              : "border-border bg-muted/30"
          }`}
        >
          {breach.cnilDeadlineExceeded ? (
            <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <Clock className="size-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <div className="text-sm">
            <p className="font-medium">
              {breach.cnilDeadlineExceeded
                ? "Délai CNIL 72h DÉPASSÉ"
                : `Délai CNIL 72h : ${breach.cnilDeadlineHoursRemaining}h restantes`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              RGPD Art. 33 — notification CNIL obligatoire sous 72h après détection (severity high/critical).
            </p>
          </div>
        </div>
      )}

      {/* Détails */}
      <section className="rounded-md border p-4 space-y-3" aria-labelledby="detail-section">
        <h2 id="detail-section" className="font-semibold">
          Détails
        </h2>
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label="Détectée le">{new Date(breach.detectedAt).toLocaleString("fr-FR")}</Field>
          <Field label="Déclarée par">User #{breach.declaredBy ?? "—"}</Field>
          {breach.cnilNotifiedAt && (
            <Field label="Notifiée CNIL le">{new Date(breach.cnilNotifiedAt).toLocaleString("fr-FR")}</Field>
          )}
          {breach.usersNotifiedAt && (
            <Field label="Utilisateurs notifiés le">
              {new Date(breach.usersNotifiedAt).toLocaleString("fr-FR")} ({breach.usersNotifiedCount} users)
            </Field>
          )}
          {breach.closedAt && (
            <Field label="Clôturée le">{new Date(breach.closedAt).toLocaleString("fr-FR")}</Field>
          )}
        </dl>
      </section>

      {/* Champs éditables */}
      <section className="rounded-md border p-4 space-y-3" aria-labelledby="editable-section">
        <div className="flex items-center justify-between">
          <h2 id="editable-section" className="font-semibold">
            Champs chiffrés (description, remédiation, dossier CNIL)
          </h2>
          {!editing && breach.status !== "closed" && (
            <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => setEditing(true)}>
              Modifier
            </DiabeoButton>
          )}
        </div>
        {editing ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span>Description</span>
              <textarea
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                className="rounded-md border bg-background px-3 py-2 min-h-[80px]"
                maxLength={5000}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Remédiation</span>
              <textarea
                value={draftRemediation}
                onChange={(e) => setDraftRemediation(e.target.value)}
                className="rounded-md border bg-background px-3 py-2 min-h-[80px]"
                maxLength={5000}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>N° dossier CNIL</span>
              <input
                type="text"
                value={draftCnilCase}
                onChange={(e) => setDraftCnilCase(e.target.value)}
                className="rounded-md border bg-background px-3 py-2"
                maxLength={64}
                placeholder="Ex: CNIL-2026-XXX"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <DiabeoButton variant="diabeoTertiary" onClick={() => setEditing(false)}>
                Annuler
              </DiabeoButton>
              <DiabeoButton onClick={() => void handleSave()} disabled={state === "saving"}>
                {state === "saving" ? "Enregistrement…" : "Enregistrer"}
              </DiabeoButton>
            </div>
          </>
        ) : (
          <dl className="space-y-3 text-sm">
            <Field label="Description">
              {breach.description ?? <span className="text-muted-foreground italic">—</span>}
            </Field>
            <Field label="Remédiation">
              {breach.remediation ?? <span className="text-muted-foreground italic">—</span>}
            </Field>
            <Field label="N° dossier CNIL">
              {breach.cnilCaseNumber ?? <span className="text-muted-foreground italic">—</span>}
            </Field>
          </dl>
        )}
      </section>

      {/* Workflow FSM */}
      {allowedTransitions.length > 0 && (
        <section className="rounded-md border p-4 space-y-3" aria-labelledby="workflow-section">
          <h2 id="workflow-section" className="font-semibold">
            Workflow FSM (RGPD Art. 33)
          </h2>
          <p className="text-xs text-muted-foreground">
            Statut actuel : <strong>{STATUS_LABELS[breach.status]}</strong>. Transitions autorisées :
          </p>
          {allowedTransitions.includes("notified_users") && (
            <label className="flex flex-col gap-1 text-sm">
              <span>Nombre d&apos;utilisateurs notifiés (requis pour transition &quot;Utilisateurs notifiés&quot;)</span>
              <input
                type="number"
                min={0}
                max={10_000_000}
                value={usersNotified}
                onChange={(e) => setUsersNotified(e.target.value)}
                className="rounded-md border bg-background px-3 py-2 max-w-[200px]"
                placeholder="Ex: 1500"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {allowedTransitions.map((to) => (
              <DiabeoButton
                key={to}
                variant={to === "closed" ? "diabeoTertiary" : "diabeoPrimary"}
                onClick={() => void handleTransition(to)}
                disabled={transitionPending !== null}
              >
                {transitionPending === to ? "…" : (
                  <>
                    {STATUS_LABELS[to]}
                    <ChevronRight className="size-3.5 ml-1" aria-hidden="true" />
                  </>
                )}
              </DiabeoButton>
            ))}
          </div>
        </section>
      )}

      {errorMessage && (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
          <p className="text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            {errorMessage}
          </p>
        </div>
      )}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}
