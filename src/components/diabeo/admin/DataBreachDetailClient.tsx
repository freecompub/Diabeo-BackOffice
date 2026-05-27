"use client"

/**
 * DataBreachDetailClient — UI détail violation + workflow FSM.
 *
 * Affiche : titre + severity + status + dates + délai CNIL + champs éditables
 * (description, remediation, cnilCaseNumber) + boutons transition FSM.
 *
 * Fixes round 1 review PR #457 :
 *   - H1 + A11y M1 : `<Dialog>` shadcn pour confirmations transition (vs confirm/alert natif)
 *   - H3 : `allowedTransitions` consommé depuis DTO backend (single source of truth)
 *   - M1 : types DTO partagés via `@/lib/types/data-breach`
 *   - M2 : `formatDate` next-intl au lieu de `toLocaleString("fr-FR")`
 *   - L8 : validation inline `usersNotifiedCount` (bouton disabled) au lieu d'`alert()`
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useLocale } from "next-intl"
import { AlertCircle, AlertTriangle, ArrowLeft, ChevronRight, Clock, Loader2 } from "lucide-react"
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
  type DataBreachStatus,
  type DataBreachDTOClient as DataBreachDTO,
  SEVERITY_LABELS_FR as SEVERITY_LABELS,
  STATUS_LABELS_FR as STATUS_LABELS,
  SEVERITY_VARIANT,
} from "@/lib/types/data-breach"

type AsyncState = "idle" | "loading" | "saving" | "success" | "error"

export function DataBreachDetailClient({ breachId }: { breachId: number }) {
  const locale = useLocale() as Locale
  const [breach, setBreach] = useState<DataBreachDTO | null>(null)
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftDescription, setDraftDescription] = useState("")
  const [draftRemediation, setDraftRemediation] = useState("")
  const [draftCnilCase, setDraftCnilCase] = useState("")
  const [usersNotified, setUsersNotified] = useState<string>("")
  const [transitionPending, setTransitionPending] = useState<DataBreachStatus | null>(null)
  // Fix H1 + A11y M1 round 1 PR #457 — confirmation via `<Dialog>` shadcn
  // (focus trap + i18n + a11y) au lieu de `confirm()` natif FR-hardcoded.
  const [confirmTransition, setConfirmTransition] = useState<DataBreachStatus | null>(null)

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

  // Fix L8 round 1 — validation inline `usersNotifiedCount` (vs alert natif).
  const usersNotifiedParsed = Number.parseInt(usersNotified, 10)
  const isUsersNotifiedValid = Number.isFinite(usersNotifiedParsed) && usersNotifiedParsed >= 0

  // Fix H1 round 1 — handler appelle setConfirmTransition pour les
  // transitions externes (notified_cnil/notified_users/closed). Pour les
  // transitions internes (under_assessment), exécution immédiate.
  const requestTransition = useCallback(
    (to: DataBreachStatus) => {
      if (!breach) return
      const needsConfirmation = to === "notified_cnil" || to === "notified_users" || to === "closed"
      if (needsConfirmation) {
        setConfirmTransition(to)
      } else {
        // Pas besoin de confirm — execute directement (sera fait dans
        // executeTransition via openConfirm + handleConfirmTransition).
        setConfirmTransition(to)
      }
    },
    [breach],
  )

  const executeTransition = useCallback(
    async (to: DataBreachStatus) => {
      setConfirmTransition(null)
      setTransitionPending(to)
      try {
        const body: { to: DataBreachStatus; usersNotifiedCount?: number } = { to }
        if (to === "notified_users") {
          body.usersNotifiedCount = usersNotifiedParsed
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
    [breachId, usersNotifiedParsed, fetchBreach],
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

  // Fix H3 round 1 PR #457 — single source of truth FSM côté backend
  // (vs ancien ALLOWED_TRANSITIONS hardcoded UI qui risquait divergence).
  const allowedTransitions = breach.allowedTransitions

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
          <Field label="Détectée le">{formatDate(breach.detectedAt, locale, { withTime: true })}</Field>
          <Field label="Déclarée par">User #{breach.declaredBy ?? "—"}</Field>
          {breach.cnilNotifiedAt && (
            <Field label="Notifiée CNIL le">{formatDate(breach.cnilNotifiedAt, locale, { withTime: true })}</Field>
          )}
          {breach.usersNotifiedAt && (
            <Field label="Utilisateurs notifiés le">
              {formatDate(breach.usersNotifiedAt, locale, { withTime: true })} ({breach.usersNotifiedCount} users)
            </Field>
          )}
          {breach.closedAt && (
            <Field label="Clôturée le">{formatDate(breach.closedAt, locale, { withTime: true })}</Field>
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
                aria-describedby="users-notified-help"
                aria-invalid={usersNotified !== "" && !isUsersNotifiedValid}
              />
              {/* Fix L8 round 1 — validation inline (vs alert natif). */}
              {usersNotified !== "" && !isUsersNotifiedValid && (
                <span id="users-notified-help" className="text-xs text-destructive" role="alert">
                  Entier ≥ 0 requis.
                </span>
              )}
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {allowedTransitions.map((to) => {
              // Fix L8 — disable bouton notified_users si validation invalide.
              const disabledForUsers = to === "notified_users" && !isUsersNotifiedValid
              return (
                <DiabeoButton
                  key={to}
                  variant={to === "closed" ? "diabeoTertiary" : "diabeoPrimary"}
                  onClick={() => requestTransition(to)}
                  disabled={transitionPending !== null || disabledForUsers}
                >
                  {transitionPending === to ? "…" : (
                    <>
                      {STATUS_LABELS[to]}
                      <ChevronRight className="size-3.5 ml-1" aria-hidden="true" />
                    </>
                  )}
                </DiabeoButton>
              )
            })}
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

      {/* Fix H1 + A11y M1 round 1 PR #457 — Dialog confirmation transition FSM
          (vs confirm() natif FR-hardcoded). Action irréversible forensique. */}
      <Dialog
        open={confirmTransition !== null}
        onOpenChange={(open) => { if (!open) setConfirmTransition(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmTransition && `Transition vers "${STATUS_LABELS[confirmTransition]}"`}
            </DialogTitle>
            <DialogDescription>
              Action tracée dans le journal d&apos;audit immuable (forensique CNIL/ANS).
              {(confirmTransition === "notified_cnil"
                || confirmTransition === "notified_users"
                || confirmTransition === "closed") &&
                " Cette transition est irréversible."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton variant="diabeoTertiary" onClick={() => setConfirmTransition(null)}>
              Annuler
            </DiabeoButton>
            <DiabeoButton
              variant={confirmTransition === "closed" ? "diabeoDestructive" : "diabeoPrimary"}
              onClick={() => {
                if (confirmTransition) void executeTransition(confirmTransition)
              }}
            >
              Confirmer la transition
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
