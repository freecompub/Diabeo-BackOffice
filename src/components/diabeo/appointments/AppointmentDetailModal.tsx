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
 * **Sécurité** :
 *   - Le payload déchiffré (`motif`, `note`, `cancelReason`) n'existe que
 *     pendant l'ouverture du modal. À la fermeture, le hook `useAppointmentDetail`
 *     reset son state et abort le fetch en cours.
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

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
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

type SubMode = "view" | "cancel" | "proposeAlt"

export interface AppointmentDetailModalProps {
  /** Résultat du hook `useAppointmentDetail(id)`. */
  state: UseAppointmentDetailResult
  /** id du RDV ouvert (null = modal fermé). */
  openId: number | null
  /** Callback fermeture (modal + parent state). */
  onClose: () => void
  /** Callback succès action (cancel ou proposeAlt) — parent refresh liste. */
  onActionSuccess: () => void
  /** Rôle utilisateur courant (pour gating bouton "Proposer alternative"). */
  userRole: "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"
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

function canProposeAlternative(role: string): boolean {
  return role === "ADMIN" || role === "DOCTOR"
}

/**
 * Formatte `date` (yyyy-mm-dd) + `hour` (hh:mm:ss | null) en wall-clock
 * lisible. Aucune conversion timezone (cf. adapter.ts §contrat timezone).
 */
function formatDateTime(date: string, hour: string | null, locale: string): string {
  const datePart = date.includes("T") ? date.split("T")[0] : date
  const [y, m, d] = datePart.split("-").map(Number)
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC", // wall-clock — pas de conversion
  })
  const dateLabel = formatter.format(new Date(Date.UTC(y, m - 1, d)))
  if (!hour) return dateLabel
  const hourPart = hour.includes("T") ? hour.split("T")[1].slice(0, 5) : hour.slice(0, 5)
  return `${dateLabel} - ${hourPart}`
}

export function AppointmentDetailModal({
  state,
  openId,
  onClose,
  onActionSuccess,
  userRole,
}: AppointmentDetailModalProps) {
  const t = useTranslations("appointments")
  const [subMode, setSubMode] = useState<SubMode>("view")
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Reset sub-mode quand on change de RDV (ou close).
  useEffect(() => {
    setSubMode("view")
    setActionError(null)
  }, [openId])

  const { detail, loading, error } = state

  function handleClose() {
    if (actionLoading) return // garde anti-fermeture pendant action
    onClose()
  }

  async function submitCancel(actor: "patient" | "doctor", reason: string) {
    if (!detail) return
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
        setActionError(body.error ?? `httpError:${res.status}`)
        return
      }
      onActionSuccess()
      onClose()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "networkError")
    } finally {
      setActionLoading(false)
    }
  }

  async function submitProposeAlt(alternativeAtIso: string) {
    if (!detail) return
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
        setActionError(body.error ?? `httpError:${res.status}`)
        return
      }
      onActionSuccess()
      onClose()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "networkError")
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <Dialog open={openId !== null} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-lg">
        {loading && !detail && (
          <div role="status" aria-busy="true" className="py-8 text-center text-sm text-muted-foreground">
            {t("loading")}
          </div>
        )}

        {error && !detail && (
          <div role="alert" className="py-8 text-center text-sm text-red-600">
            {t("detailLoadError")}
          </div>
        )}

        {detail && subMode === "view" && (
          <ViewMode
            detail={detail}
            userRole={userRole}
            onCancel={() => setSubMode("cancel")}
            onPropose={() => setSubMode("proposeAlt")}
            onClose={handleClose}
          />
        )}

        {detail && subMode === "cancel" && (
          <CancelForm
            detail={detail}
            loading={actionLoading}
            error={actionError}
            onSubmit={submitCancel}
            onBack={() => setSubMode("view")}
          />
        )}

        {detail && subMode === "proposeAlt" && (
          <ProposeAlternativeForm
            detail={detail}
            loading={actionLoading}
            error={actionError}
            onSubmit={submitProposeAlt}
            onBack={() => setSubMode("view")}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ─── Sous-composants ──────────────────────────────────────────── */

interface ViewModeProps {
  detail: AppointmentDetail
  userRole: string
  onCancel: () => void
  onPropose: () => void
  onClose: () => void
}

function ViewMode({ detail, userRole, onCancel, onPropose, onClose }: ViewModeProps) {
  const t = useTranslations("appointments")
  const locale = (typeof navigator !== "undefined" && navigator.language) || "fr-FR"

  const actionable = isActionable(detail.status)
  const showPropose = actionable && canProposeAlternative(userRole)

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
              {detail.cancelledAt
                ? new Date(detail.cancelledAt).toLocaleString(locale)
                : "—"}
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
            {new Date(detail.proposedAlternativeAt).toLocaleString(locale)}
          </Field>
        )}

        <Field label={t("patientLabel")}>
          <a
            href={`/patients/${detail.patientId}`}
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
  detail: AppointmentDetail
  loading: boolean
  error: string | null
  onSubmit: (actor: "patient" | "doctor", reason: string) => void
  onBack: () => void
}

function CancelForm({ detail, loading, error, onSubmit, onBack }: CancelFormProps) {
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
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t("actorLegend")}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="actor"
              value="doctor"
              checked={actor === "doctor"}
              onChange={() => setActor("doctor")}
            />
            {t("actorDoctor")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="actor"
              value="patient"
              checked={actor === "patient"}
              onChange={() => setActor("patient")}
            />
            {t("actorPatient")}
          </label>
        </fieldset>

        <div className="grid gap-2">
          <Label htmlFor="cancel-reason">{t("cancelReasonLabel")}</Label>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            className="border border-input rounded-md p-2 text-sm bg-background resize-none"
            placeholder={t("cancelReasonPlaceholder")}
            aria-describedby="cancel-reason-help"
          />
          <p id="cancel-reason-help" className="text-xs text-muted-foreground">
            {reason.length} / 500
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
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
      <input type="hidden" data-testid="appt-id" value={detail.id} readOnly />
    </>
  )
}

interface ProposeAltFormProps {
  detail: AppointmentDetail
  loading: boolean
  error: string | null
  onSubmit: (alternativeAtIso: string) => void
  onBack: () => void
}

function ProposeAlternativeForm({
  detail,
  loading,
  error,
  onSubmit,
  onBack,
}: ProposeAltFormProps) {
  const t = useTranslations("appointments")
  // Pré-remplir avec la date+heure actuelle du RDV (l'utilisateur ajuste).
  const initialDate = detail.date.split("T")[0]
  const initialTime = detail.hour ? detail.hour.slice(0, 5) : "09:00"
  const [dateStr, setDateStr] = useState(initialDate)
  const [timeStr, setTimeStr] = useState(initialTime)

  // Borne min = aujourd'hui (anti proposition rétro-active).
  const today = new Date().toISOString().split("T")[0]

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
          // Le backend coerce avec `z.coerce.date()` qui interprète en UTC
          // si pas de tz — c'est OK pour le contrat current (cf. timezone V1.5).
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
            onChange={(e) => setDateStr(e.target.value)}
            required
            className="border border-input rounded-md p-2 text-sm bg-background"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="propose-time">{t("hourLabel")}</Label>
          <input
            type="time"
            id="propose-time"
            value={timeStr}
            onChange={(e) => setTimeStr(e.target.value)}
            required
            className="border border-input rounded-md p-2 text-sm bg-background"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
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
