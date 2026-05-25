"use client"

/**
 * AppointmentDetailModal — modal détail RDV (clic sur événement Schedule-X).
 *
 * US-2500-UI iter 5 — sous-modes :
 *   - `view` (défaut) : affiche les détails du RDV (déchiffré côté backend),
 *     plus les boutons d'action selon statut + rôle
 *   - `cancel` : form pour annuler (radio actor + textarea reason)
 *   - `proposeAlt` : form pour proposer une nouvelle date/heure (DOCTOR only)
 *
 * **Architecture lifecycle** (Fix CR-1 + FE-5 + FE-7 + FE-12 round 1) :
 *   Le parent `<AppointmentCalendar>` ne monte ce composant que lorsque
 *   `openedApptId !== null`, et applique `key={openedApptId}` → React unmount
 *   complet entre chaque ouverture. Conséquences :
 *     - State interne (`subMode`, `actionError`, drafts `reason`/`dateStr`/
 *       `timeStr`) garantis frais à chaque ouverture (anti-PHI résiduel)
 *     - Pas besoin de `useEffect([openId])` pour reset (anti-pattern setState-
 *       in-effect cascading-renders évité)
 *
 * **Sécurité** :
 *   - Le payload déchiffré (`motif`, `note`, `cancelReason`) n'existe que
 *     pendant l'ouverture du modal. À la fermeture (unmount complet via key),
 *     le hook `useAppointmentDetail` reset son state et abort le fetch en cours.
 *   - Audit READ ciblé est tiré côté backend dans `getById`.
 *   - Les actions cancel/propose-alternative déclenchent un audit UPDATE
 *     côté backend dans les services correspondants.
 *
 * **RBAC** :
 *   - `Annuler` : NURSE+ (le backend gate enforce, on cache le bouton sinon)
 *   - `Proposer alternative` : DOCTOR+ uniquement (gate côté backend strict).
 *     Pour NURSE, on cache le bouton (pas de "disabled" trompeur).
 *
 * **Status-gating** :
 *   - `cancelled` / `completed` / `no_show` → pas d'action possible (lecture seule)
 *   - `scheduled` / `pending_validation` / `confirmed` → cancel + proposeAlt
 *     (selon rôle)
 *
 * @see useAppointmentDetail
 * @see src/app/api/appointments/[id]/cancel/route.ts
 * @see src/app/api/appointments/[id]/propose-alternative/route.ts
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import type {
  AppointmentDetail,
  UseAppointmentDetailResult,
} from "./useAppointmentDetail"

/**
 * Type union strict pour le rôle (Fix M-5 round 1 review PR #433) — propagé
 * jusqu'aux helpers pour éviter qu'un futur dev passe un string arbitraire.
 */
export type UserRole = "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"

type SubMode = "view" | "cancel" | "proposeAlt"

export interface AppointmentDetailModalProps {
  /** Résultat du hook `useAppointmentDetail(id)`. */
  state: UseAppointmentDetailResult
  /** id du RDV ouvert (null = modal fermé, mais le parent gère le mount-on-open). */
  openId: number | null
  /** Callback fermeture (modal + parent state). */
  onClose: () => void
  /** Callback succès action (cancel ou proposeAlt) — parent refresh liste. */
  onActionSuccess: () => void
  /** Rôle utilisateur courant (pour gating bouton "Proposer alternative"). */
  userRole: UserRole
}

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  scheduled: "default",
  pending_validation: "outline",
  confirmed: "default",
  cancelled: "destructive",
  completed: "secondary",
  no_show: "destructive",
}

function isActionable(status: string): boolean {
  return status === "scheduled" || status === "pending_validation" || status === "confirmed"
}

function canProposeAlternative(role: UserRole): boolean {
  return role === "ADMIN" || role === "DOCTOR"
}

export function AppointmentDetailModal({
  state,
  openId,
  onClose,
  onActionSuccess,
  userRole,
}: AppointmentDetailModalProps) {
  const t = useTranslations("appointments")
  // Fix FE-1 + HSA-5 round 1 review PR #433 — utiliser `useLocale()` next-intl
  // au lieu de `navigator.language` pour cohérence avec LocaleSwitcher (US-2112).
  // Évite l'incohérence FR-UI / EN-dates si user a un navigateur en anglais.
  const locale = useLocale()

  const [subMode, setSubMode] = useState<SubMode>("view")
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Fix HSA-4 round 1 review PR #433 — mountedRef pour éviter setState sur
  // composant unmounted (warn React + cycle audit log inutile côté backend).
  // En pratique le garde `handleClose actionLoading` prévient ce cas, mais
  // defense-in-depth pour Escape/backdrop si jamais le garde est contourné.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const { detail, loading, error } = state

  const handleClose = useCallback(() => {
    if (actionLoading) return // garde anti-fermeture pendant action
    onClose()
  }, [actionLoading, onClose])

  // Fix H-1 + FE-2 round 1 review PR #433 — guard double-submit + clear
  // actionError au prochain change form (input/textarea/radio).
  const clearError = useCallback(() => {
    if (actionError !== null) setActionError(null)
  }, [actionError])

  const submitCancel = useCallback(
    async (actor: "patient" | "doctor", reason: string) => {
      if (!detail || actionLoading) return // Fix H-1 garde guard contre double submit
      setActionLoading(true)
      setActionError(null)
      try {
        const res = await fetch(`/api/appointments/${detail.id}/cancel`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ actor, reason: reason.trim() || undefined }),
        })
        if (!res.ok) {
          if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = "/login?expired=1"
            return
          }
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          if (mountedRef.current) setActionError(body.error ?? `httpError:${res.status}`)
          return
        }
        onActionSuccess()
        onClose()
      } catch (err) {
        if (mountedRef.current) {
          setActionError(err instanceof Error ? err.message : "networkError")
        }
      } finally {
        if (mountedRef.current) setActionLoading(false)
      }
    },
    [detail, actionLoading, onActionSuccess, onClose],
  )

  const submitProposeAlt = useCallback(
    async (alternativeAtIso: string) => {
      if (!detail || actionLoading) return // Fix H-1
      setActionLoading(true)
      setActionError(null)
      try {
        const res = await fetch(`/api/appointments/${detail.id}/propose-alternative`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ alternativeAt: alternativeAtIso }),
        })
        if (!res.ok) {
          if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = "/login?expired=1"
            return
          }
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          if (mountedRef.current) setActionError(body.error ?? `httpError:${res.status}`)
          return
        }
        onActionSuccess()
        onClose()
      } catch (err) {
        if (mountedRef.current) {
          setActionError(err instanceof Error ? err.message : "networkError")
        }
      } finally {
        if (mountedRef.current) setActionLoading(false)
      }
    },
    [detail, actionLoading, onActionSuccess, onClose],
  )

  return (
    <Dialog
      open={openId !== null}
      // Fix H-3 + FE-3 round 1 review PR #433 — Base UI Dialog en mode
      // **contrôlé** (`open=openId !== null`) : si on n'appelle pas `handleClose`
      // (qui contient le garde `actionLoading`), l'état contrôlé reste à `open`
      // et Base UI respecte ce contrat → pas de flash close ni focus perdu
      // pour Escape/clic backdrop. (Vs Radix qui exposerait onEscapeKeyDown
      // dédiés.) Le garde couvre toutes les sources de dismiss : X close icon,
      // Escape, clic backdrop, et `onActionSuccess→onClose` post-submit.
      onOpenChange={(o) => { if (!o) handleClose() }}
    >
      <DialogContent className="sm:max-w-lg">
        {loading && !detail && (
          <div
            role="status"
            aria-busy="true"
            aria-live="polite"
            className="py-8 text-center text-sm text-muted-foreground"
          >
            {t("loading")}
          </div>
        )}

        {error && !detail && (
          <div role="alert" aria-live="assertive" className="py-8 text-center text-sm text-red-600">
            {t("detailLoadError")}
          </div>
        )}

        {detail && subMode === "view" && (
          <ViewMode
            detail={detail}
            userRole={userRole}
            locale={locale}
            onCancel={() => setSubMode("cancel")}
            onPropose={() => setSubMode("proposeAlt")}
            onClose={handleClose}
          />
        )}

        {detail && subMode === "cancel" && (
          <CancelForm
            loading={actionLoading}
            error={actionError}
            onSubmit={submitCancel}
            onBack={() => {
              if (actionLoading) return
              setSubMode("view")
              setActionError(null)
            }}
            onChangeClearsError={clearError}
          />
        )}

        {detail && subMode === "proposeAlt" && (
          <ProposeAlternativeForm
            detail={detail}
            loading={actionLoading}
            error={actionError}
            onSubmit={submitProposeAlt}
            onBack={() => {
              if (actionLoading) return
              setSubMode("view")
              setActionError(null)
            }}
            onChangeClearsError={clearError}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ─── Sous-composants ──────────────────────────────────────────── */

interface ViewModeProps {
  detail: AppointmentDetail
  userRole: UserRole
  locale: string
  onCancel: () => void
  onPropose: () => void
  onClose: () => void
}

/**
 * Fix M-4 + FE-4 round 1 review PR #433 — `Intl.DateTimeFormat` mémorisé
 * par locale (rebuild instance coûte ~10x un format()). Cache module-level
 * partagé entre instances de ViewMode.
 */
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()
function getDateFormatter(locale: string): Intl.DateTimeFormat {
  let f = dateFormatterCache.get(locale)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "UTC", // wall-clock — pas de conversion
    })
    dateFormatterCache.set(locale, f)
  }
  return f
}

/**
 * Fix L-2 round 1 review PR #433 — formatter timestamp `toLocaleString` avec
 * options stables (jour court + heure-minute) au lieu du défaut runtime-dépendant.
 */
const timestampFormatterCache = new Map<string, Intl.DateTimeFormat>()
function getTimestampFormatter(locale: string): Intl.DateTimeFormat {
  let f = timestampFormatterCache.get(locale)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    timestampFormatterCache.set(locale, f)
  }
  return f
}

/**
 * Formatte `date` (yyyy-mm-dd) + `hour` (hh:mm:ss | null) en wall-clock
 * lisible. Aucune conversion timezone (cf. adapter.ts §contrat timezone).
 */
function formatDateTime(date: string, hour: string | null, locale: string): string {
  const datePart = date.includes("T") ? date.split("T")[0] : date
  const [y, m, d] = datePart.split("-").map(Number)
  const dateLabel = getDateFormatter(locale).format(new Date(Date.UTC(y, m - 1, d)))
  if (!hour) return dateLabel
  const hourPart = hour.includes("T") ? hour.split("T")[1].slice(0, 5) : hour.slice(0, 5)
  return `${dateLabel} - ${hourPart}`
}

function ViewMode({ detail, userRole, locale, onCancel, onPropose, onClose }: ViewModeProps) {
  const t = useTranslations("appointments")

  const actionable = isActionable(detail.status)
  const showPropose = actionable && canProposeAlternative(userRole)

  const tsFormatter = useMemo(() => getTimestampFormatter(locale), [locale])

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          {t(`type.${detail.type ?? "other"}`)}
          <Badge variant={STATUS_BADGE_VARIANT[detail.status] ?? "outline"}>
            {t(`status.${detail.status}`)}
          </Badge>
        </DialogTitle>
        <DialogDescription>
          {formatDateTime(detail.date, detail.hour, locale)}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 py-2 text-sm">
        <Field label={t("durationLabel")}>
          {detail.durationMinutes ?? 30} {t("minutesShort")}
        </Field>

        {detail.location && (
          <Field label={t("locationLabel")}>
            {t(`location.${detail.location}`)}
          </Field>
        )}

        {detail.motif && (
          <Field label={t("motifLabel")}>
            <span className="whitespace-pre-line">{detail.motif}</span>
          </Field>
        )}

        {detail.note && (
          <Field label={t("noteLabel")}>
            <span className="whitespace-pre-line">{detail.note}</span>
          </Field>
        )}

        {detail.status === "cancelled" && (
          <>
            <Field label={t("cancelledAtLabel")}>
              {detail.cancelledAt ? tsFormatter.format(new Date(detail.cancelledAt)) : "—"}
            </Field>
            {detail.cancelledBy && (
              <Field label={t("cancelledByLabel")}>
                {t(`cancelledBy.${detail.cancelledBy}`)}
              </Field>
            )}
            {detail.cancelReason && (
              <Field label={t("cancelReasonLabel")}>
                <span className="whitespace-pre-line">{detail.cancelReason}</span>
              </Field>
            )}
          </>
        )}

        {detail.proposedAlternativeAt && (
          <Field label={t("proposedAlternativeAtLabel")}>
            {tsFormatter.format(new Date(detail.proposedAlternativeAt))}
          </Field>
        )}

        <Field label={t("patientLabel")}>
          {/* Fix HSA-2 round 1 review PR #433 — `rel="noreferrer"` empêche le
              leak via Referer de l'URL d'origine `/appointments?memberId=X`
              vers la page patient (et ses éventuelles ressources tierces). */}
          <a
            href={`/patients/${detail.patientId}`}
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            {t("patientViewLink", { id: detail.patientId })}
          </a>
        </Field>
      </div>

      <DialogFooter>
        {actionable && (
          <Button variant="outline" onClick={onCancel}>
            {t("actionCancel")}
          </Button>
        )}
        {showPropose && (
          <Button variant="outline" onClick={onPropose}>
            {t("actionProposeAlternative")}
          </Button>
        )}
        <Button onClick={onClose}>{t("actionClose")}</Button>
      </DialogFooter>
    </>
  )
}

interface CancelFormProps {
  loading: boolean
  error: string | null
  onSubmit: (actor: "patient" | "doctor", reason: string) => void
  onBack: () => void
  onChangeClearsError: () => void
}

/**
 * Fix L-1 round 1 review PR #433 — Default `actor="doctor"` car la majorité
 * des annulations en cabinet sont initiées par le pro (secrétariat enregistre
 * l'annulation lors du créneau perdu, pas le patient qui appelle).
 */
function CancelForm({ loading, error, onSubmit, onBack, onChangeClearsError }: CancelFormProps) {
  const t = useTranslations("appointments")
  const [actor, setActor] = useState<"patient" | "doctor">("doctor")
  const [reason, setReason] = useState("")

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("cancelTitle")}</DialogTitle>
        <DialogDescription>{t("cancelDescription")}</DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(actor, reason)
        }}
        className="grid gap-4 py-2"
      >
        <fieldset className="grid gap-2" disabled={loading}>
          <legend className="text-sm font-medium">{t("actorLegend")}</legend>
          {/* Fix L-5 + FE-15 round 1 review PR #433 — touch target ≥ 44px (WCAG 2.5.5) :
              `min-h-[44px]` sur le label englobant le radio + texte. */}
          <label className="flex items-center gap-2 text-sm min-h-[44px]">
            <input
              type="radio"
              name="actor"
              value="doctor"
              checked={actor === "doctor"}
              onChange={() => { setActor("doctor"); onChangeClearsError() }}
            />
            {t("actorDoctor")}
          </label>
          <label className="flex items-center gap-2 text-sm min-h-[44px]">
            <input
              type="radio"
              name="actor"
              value="patient"
              checked={actor === "patient"}
              onChange={() => { setActor("patient"); onChangeClearsError() }}
            />
            {t("actorPatient")}
          </label>
        </fieldset>

        <div className="grid gap-2">
          <Label htmlFor="cancel-reason">{t("cancelReasonLabel")}</Label>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => { setReason(e.target.value); onChangeClearsError() }}
            maxLength={500}
            rows={3}
            disabled={loading}
            className="border border-input rounded-md p-2 text-sm bg-background resize-none disabled:opacity-50"
            placeholder={t("cancelReasonPlaceholder")}
            aria-describedby="cancel-reason-help"
          />
          <p id="cancel-reason-help" className="text-xs text-muted-foreground">
            {reason.length} / 500
          </p>
        </div>

        {error && (
          // Fix FE-9 round 1 review PR #433 — `aria-live="assertive"` +
          // `key={error}` force ré-annonce du lecteur d'écran si message
          // identique sur retry. `role="alert"` reste pour fallback.
          // HSA-3 : on render UNIQUEMENT la clé i18n `actionError` générique,
          // jamais `error` brut (defense-in-depth contre PHI/PII backend).
          <p
            key={error}
            role="alert"
            aria-live="assertive"
            className="text-sm text-red-600"
          >
            {t("actionError")}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onBack} disabled={loading}>
            {t("actionBack")}
          </Button>
          <Button type="submit" variant="destructive" disabled={loading}>
            {loading ? t("loading") : t("actionConfirmCancel")}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

interface ProposeAltFormProps {
  detail: AppointmentDetail
  loading: boolean
  error: string | null
  onSubmit: (alternativeAtIso: string) => void
  onBack: () => void
  onChangeClearsError: () => void
}

function ProposeAlternativeForm({
  detail,
  loading,
  error,
  onSubmit,
  onBack,
  onChangeClearsError,
}: ProposeAltFormProps) {
  const t = useTranslations("appointments")
  // Pré-remplir avec la date+heure actuelle du RDV (l'utilisateur ajuste).
  const initialDate = detail.date.split("T")[0]
  const initialTime = detail.hour ? detail.hour.slice(0, 5) : "09:00"
  const [dateStr, setDateStr] = useState(initialDate)
  const [timeStr, setTimeStr] = useState(initialTime)

  // Fix H-4 round 1 review PR #433 — Borne min snapshot lazy au mount (vs
  // recomputed à chaque render). Sans ça, un re-render à minuit (polling
  // parent 60s) changerait `min` et invaliderait silencieusement la valeur
  // saisie. `useState(() => ...)` exécute la lambda une seule fois.
  const [today] = useState(() => new Date().toISOString().split("T")[0])

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("proposeAltTitle")}</DialogTitle>
        <DialogDescription>{t("proposeAltDescription")}</DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          // Combine date + time en ISO local (sans tz suffix = wall-clock).
          // **Note timezone (HSA-6 round 1 review PR #433)** : le backend
          // `z.coerce.date()` interprète UTC si pas de tz. Le contrat wall-clock
          // global (cf. adapter.ts) suppose que le cabinet et le médecin sont
          // dans le même fuseau (Europe/Paris). Issue V1.5 tracker :
          // `HealthcareService.timezone` à ajouter au schema + conversion
          // explicite cohérente avec pattern PR #418 round 3 (formatDateTime
          // reminders). En attendant, cet envoi est sûr pour le 1er release
          // tant que les utilisateurs restent dans le fuseau cabinet.
          const iso = `${dateStr}T${timeStr}:00`
          onSubmit(iso)
        }}
        className="grid gap-4 py-2"
      >
        <div className="grid gap-2">
          <Label htmlFor="propose-date">{t("dateLabel")}</Label>
          <input
            type="date"
            id="propose-date"
            value={dateStr}
            min={today}
            onChange={(e) => { setDateStr(e.target.value); onChangeClearsError() }}
            required
            disabled={loading}
            className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="propose-time">{t("hourLabel")}</Label>
          <input
            type="time"
            id="propose-time"
            value={timeStr}
            onChange={(e) => { setTimeStr(e.target.value); onChangeClearsError() }}
            required
            disabled={loading}
            className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
          />
        </div>

        {error && (
          <p
            key={error}
            role="alert"
            aria-live="assertive"
            className="text-sm text-red-600"
          >
            {t("actionError")}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onBack} disabled={loading}>
            {t("actionBack")}
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? t("loading") : t("actionConfirmPropose")}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

interface FieldProps {
  label: string
  children: React.ReactNode
}

function Field({ label, children }: FieldProps) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}
