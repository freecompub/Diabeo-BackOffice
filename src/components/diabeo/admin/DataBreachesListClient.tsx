"use client"

/**
 * DataBreachesListClient — UI US-2137 Notification violation CNIL (RGPD Art. 33).
 *
 * Affiche la liste des violations déclarées + filtres status/severity +
 * bouton "Déclarer une violation" qui ouvre dialog de création.
 *
 * Backend : `dataBreachService` (PR #409 Groupe 9 Admin/Ops).
 *
 * Fixes round 1 review PR #457 :
 *   - C2 + H2 + A11y C1+C2 : utilise `<Dialog>` shadcn (focus trap + ESC +
 *     restore focus + ARIA correct) au lieu d'un modal custom
 *   - H2 : `AbortController` pour fetch (race condition sur filter change rapide)
 *   - H1 : confirm `<AlertDialog>` shadcn pour close si dirty form (M5)
 *   - M1 : types DTO partagés via `@/lib/types/data-breach`
 *   - M2 : `formatDateTime` next-intl au lieu de `toLocaleString("fr-FR")`
 *   - M7 : char count visible pour textarea description
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, AlertTriangle, Clock, Plus, ShieldAlert } from "lucide-react"
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
  type DataBreachSeverity,
  type DataBreachStatus,
  type DataBreachDTOClient as DataBreachDTO,
  SEVERITY_LABELS_FR as SEVERITY_LABELS,
  STATUS_LABELS_FR as STATUS_LABELS,
  SEVERITY_VARIANT,
} from "@/lib/types/data-breach"

type AsyncState = "idle" | "loading" | "success" | "error"

export function DataBreachesListClient() {
  const locale = useLocale() as Locale
  const t = useTranslations("admin.dataBreachesList")
  const [breaches, setBreaches] = useState<DataBreachDTO[]>([])
  const [state, setState] = useState<AsyncState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<DataBreachStatus | "all">("all")
  const [filterSeverity, setFilterSeverity] = useState<DataBreachSeverity | "all">("all")
  const [showDeclareDialog, setShowDeclareDialog] = useState(false)

  // Fix H2 round 1 PR #457 — AbortController + fetchSeq pour éliminer race
  // condition au changement rapide de filterStatus/filterSeverity (pattern
  // HSA-3 connu projet, cf. useMessageThreads PR #441 iter messaging).
  const abortRef = useRef<AbortController | null>(null)
  const fetchSeqRef = useRef(0)

  const fetchBreaches = useCallback(async () => {
    // Cancel any in-flight previous fetch (filter change rapide).
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++fetchSeqRef.current
    setState("loading")
    setErrorMessage(null)
    try {
      const params = new URLSearchParams()
      if (filterStatus !== "all") params.set("status", filterStatus)
      if (filterSeverity !== "all") params.set("severity", filterSeverity)
      const url = `/api/admin/data-breaches${params.toString() ? `?${params.toString()}` : ""}`
      const res = await fetch(url, { credentials: "include", signal: controller.signal })
      // Si une autre requête a démarré entre temps, ignore cette réponse.
      if (seq !== fetchSeqRef.current) return
      if (!res.ok) {
        setState("error")
        setErrorMessage(`HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { items?: DataBreachDTO[] }
      if (seq !== fetchSeqRef.current) return
      setBreaches(data.items ?? [])
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return // expected
      if (seq !== fetchSeqRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [filterStatus, filterSeverity])

  useEffect(() => {
    // fetchBreaches est intentionally re-triggered au changement de
    // filterStatus/filterSeverity (le useCallback recapture les filtres pour
    // la query URL). AbortController + fetchSeq gèrent la race condition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBreaches()
  }, [fetchBreaches])

  // Cleanup au unmount — abort fetch en cours.
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">{t("statusLabel")}</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as DataBreachStatus | "all")}
              className="rounded-md border bg-background px-2 py-1 text-sm"
              aria-label="Filtrer par statut"
            >
              <option value="all">{t("all")}</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">{t("severityLabel")}</span>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value as DataBreachSeverity | "all")}
              className="rounded-md border bg-background px-2 py-1 text-sm"
              aria-label="Filtrer par sévérité"
            >
              <option value="all">{t("allSeverities")}</option>
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
          {t("declare")}
        </DiabeoButton>
      </div>

      {state === "loading" && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("loading")}
        </p>
      )}

      {state === "error" && (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            {t("loadError")}
          </p>
          {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchBreaches()} className="mt-2">
            {t("retry")}
          </DiabeoButton>
        </div>
      )}

      {state === "success" && breaches.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <ShieldAlert className="size-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
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
                      {t("detectedOn", { date: formatDate(breach.detectedAt, locale, { withTime: true }) })}
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
                          ? t("cnilExceeded")
                          : t("cnilRemaining", { hours: breach.cnilDeadlineHoursRemaining })}
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
  const t = useTranslations("admin.dataBreachesList")
  const [severity, setSeverity] = useState<DataBreachSeverity>("medium")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitState, setSubmitState] = useState<AsyncState>("idle")
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Fix M5 round 1 PR #457 — confirm si dirty form pour éviter perte de
  // données draft (PHI potentiel) si user clique outside ou ESC.
  const [showDirtyConfirm, setShowDirtyConfirm] = useState(false)

  const isDirty = title.trim().length > 0 || description.trim().length > 0

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

  // Fix M5 — interception close si form dirty.
  const handleCloseAttempt = useCallback(() => {
    if (isDirty && submitState !== "loading") {
      setShowDirtyConfirm(true)
    } else {
      onClose()
    }
  }, [isDirty, submitState, onClose])

  return (
    <>
      {/* Fix C2 + H2 + A11y C1+C2 round 1 PR #457 — shadcn `<Dialog>` (Radix)
          gère focus trap + ESC handler + restore focus + ARIA + inert backdrop.
          Remplace le modal custom qui violait WCAG 2.1.2 + 2.4.3. */}
      <Dialog
        open={!showDirtyConfirm}
        onOpenChange={(open) => {
          if (!open) handleCloseAttempt()
        }}
      >
        <DialogContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("declareTitle")}</DialogTitle>
              <DialogDescription>
                {t("declareWarning")}
              </DialogDescription>
            </DialogHeader>

            <label className="flex flex-col gap-1 text-sm">
              <span>{t("severity")}</span>
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
                {t("titleLabel")} <span className="text-destructive" aria-label="requis">*</span>
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Fuite tokens FCM cabinet X (sans détails identifiants)"
                className="rounded-md border bg-background px-3 py-2"
                required
                maxLength={200}
                aria-describedby="declare-title-count"
              />
              {/* Fix M7 round 1 — char count visible (WCAG 3.3.2). */}
              <span id="declare-title-count" className="text-xs text-muted-foreground">
                {t("titleCount", { count: title.length })}
              </span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span>{t("descLabel")}</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Détails techniques de la violation (chiffré en base)"
                className="rounded-md border bg-background px-3 py-2 min-h-[80px]"
                maxLength={5000}
                aria-describedby="declare-desc-count"
              />
              <span id="declare-desc-count" className="text-xs text-muted-foreground">
                {t("descCount", { count: description.length })}
              </span>
            </label>

            {submitState === "error" && submitError && (
              <p role="alert" className="text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="size-4" aria-hidden="true" />
                {t("submitErrorPrefix", { error: submitError })}
              </p>
            )}

            <DialogFooter>
              <DiabeoButton type="button" variant="diabeoTertiary" onClick={handleCloseAttempt}>
                {t("cancel")}
              </DiabeoButton>
              <DiabeoButton
                type="submit"
                disabled={submitState === "loading" || title.trim().length === 0}
              >
                {submitState === "loading" ? t("creating") : t("submit")}
              </DiabeoButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Fix M5 round 1 — confirm dialog si user tente close avec dirty form. */}
      <Dialog open={showDirtyConfirm} onOpenChange={(open) => { if (!open) setShowDirtyConfirm(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("discardTitle")}</DialogTitle>
            <DialogDescription>
              {t("discardDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton variant="diabeoTertiary" onClick={() => setShowDirtyConfirm(false)}>
              {t("continueEditing")}
            </DiabeoButton>
            <DiabeoButton
              variant="diabeoDestructive"
              onClick={() => {
                setShowDirtyConfirm(false)
                onClose()
              }}
            >
              {t("discard")}
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

