"use client"

/**
 * AppointmentCreateModal — modal création RDV depuis le bouton "+ Nouveau RDV"
 * du calendrier.
 *
 * US-2500-UI iter 6 — formulaire shadcn Dialog avec :
 *   - patient (combobox autocomplete via `usePatientList`)
 *   - date + heure
 *   - durée (15-240 min, défaut 30)
 *   - location (in_person | video | phone)
 *   - type (diabeto / ide / hdj / other — whitelist alignée adapter.ts)
 *   - motif (chiffré côté backend AES-256-GCM, max 200 chars)
 *
 * **Architecture lifecycle** (réutilise pattern iter 5 AppointmentDetailModal) :
 *   Le parent ne monte ce composant que lorsque `open=true`, et applique
 *   `key` pour reset state à chaque ouverture (anti-PHI résiduel + anti-
 *   draft pollué entre ouvertures).
 *
 * **memberId** : non saisi par le user — auto-résolu par le parent
 * (`<AppointmentCalendar>`) via le pattern `effectiveMemberId` (iter 4).
 *
 * **Sécurité** :
 *   - Backend valide via Zod + RBAC + consent + audit (POST /api/appointments)
 *   - `motif`/`note` chiffrés à l'insertion en base (AES-256-GCM)
 *   - Aucun PHI dans audit metadata
 *   - Headers ANSSI sur réponse 201
 *
 * **UX** :
 *   - Date prérempli aujourd'hui, heure prérempli 09:00
 *   - Durée par défaut 30 min
 *   - Location par défaut "in_person"
 *   - Bouton disabled tant que `patientId` non sélectionné
 *
 * @see useCreateAppointment
 * @see usePatientList
 * @see PatientCombobox
 */

import { useCallback, useEffect, useMemo, useState } from "react"
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
import { Label } from "@/components/ui/label"
import { PatientCombobox } from "./PatientCombobox"
import {
  useCreateAppointment,
  type CreateAppointmentInput,
  type CreateAppointmentErrorCode,
} from "./useCreateAppointment"

const APPOINTMENT_TYPES = ["diabeto", "ide", "hdj", "other"] as const
const LOCATIONS = ["in_person", "video", "phone"] as const
// Fix FE-13 round 1 review PR #434 — Presets durée étendus :
// +20 (consultation flash) +75 (HDJ court) +180/240 (HDJ long).
const DURATION_PRESETS = [15, 20, 30, 45, 60, 75, 90, 120, 180, 240] as const
type AppointmentType = (typeof APPOINTMENT_TYPES)[number]
type Location = (typeof LOCATIONS)[number]

/**
 * Fix CR-H2 + HSA-3 round 1 review PR #434 — Mapping code erreur backend
 * (whitelist normalisée par le hook) vers clé i18n distincte. Donne au médecin
 * un feedback actionnable :
 *   - slotConflict (409) : "Le créneau est déjà pris — choisissez un autre"
 *   - gdprConsentRequired (422) : "Le patient n'a pas accepté le partage"
 *   - forbidden (403) : "Vous n'avez pas accès à ce patient"
 *   - validationFailed (400) : "Vérifiez les champs"
 *   - networkError / unexpectedError : "Erreur inattendue — réessayez"
 */
function errorCodeToI18nKey(code: CreateAppointmentErrorCode): string {
  switch (code) {
    case "slotConflict":
      return "createErrorConflict"
    case "gdprConsentRequired":
      return "createErrorConsent"
    case "forbidden":
      return "createErrorForbidden"
    case "validationFailed":
      return "createErrorValidation"
    case "networkError":
    case "unexpectedError":
    default:
      return "createErrorGeneric"
  }
}

/**
 * Format wall-clock "DD/MM/YYYY à HH:MM" en locale next-intl pour récap
 * visuel au-dessus du bouton submit (Fix FE-11 round 1 review PR #434).
 * Utilise `timeZone: "UTC"` cohérent avec contrat wall-clock iter 5.
 */
function formatRecap(date: string, hour: string, locale: string): string {
  try {
    const [y, m, d] = date.split("-").map(Number)
    const [h, mi] = hour.split(":").map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d, h, mi, 0))
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(dt)
  } catch {
    return `${date} ${hour}`
  }
}

/** Vérifie si `date + hour` est dans le futur (Fix CR-M4 round 1). */
function isInFuture(date: string, hour: string): boolean {
  if (!date || !hour) return false
  try {
    const [y, m, d] = date.split("-").map(Number)
    const [h, mi] = hour.split(":").map(Number)
    // Utilise heure locale du navigateur pour comparer (wall-clock du user).
    const target = new Date(y, m - 1, d, h, mi, 0)
    return target.getTime() > Date.now()
  } catch {
    return false
  }
}

export interface AppointmentCreateModalProps {
  /** Modal open state (contrôlé par le parent). */
  open: boolean
  /** memberId résolu par le parent (effectiveMemberId du calendrier). */
  memberId: number
  /** Callback fermeture (parent reset state). */
  onClose: () => void
  /** Callback succès création — parent refresh la liste calendar. */
  onCreated: (newId: number) => void
}

export function AppointmentCreateModal({
  open,
  memberId,
  onClose,
  onCreated,
}: AppointmentCreateModalProps) {
  const t = useTranslations("appointments")
  const locale = useLocale()
  const { loading, error, submit, reset } = useCreateAppointment()

  // Pré-remplir date = aujourd'hui (snapshot lazy au mount — Fix H-4 pattern iter 5).
  const [today] = useState(() => new Date().toISOString().split("T")[0])

  const [patientId, setPatientId] = useState<number | null>(null)
  const [dateStr, setDateStr] = useState(today)
  const [hourStr, setHourStr] = useState("09:00")
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [location, setLocation] = useState<Location>("in_person")
  const [type, setType] = useState<AppointmentType>("diabeto")
  const [motif, setMotif] = useState("")
  // Fix FE-2-5 pattern iter 5 — nonce pour re-mount du `<p role=alert>` même
  // si message d'erreur identique sur retry → screen reader re-vocalise.
  const [errorNonce, setErrorNonce] = useState(0)
  // Fix FE-16 round 1 review PR #434 — tracker submit échoué pour `aria-invalid`
  // sur les inputs (signal SR users du champ fautif).
  const [submitFailed, setSubmitFailed] = useState(false)

  // Reset hook state au close (defense-in-depth — parent unmount aussi via `key`).
  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  // Fix CR-M4 round 1 review PR #434 — validation date+hour future client-side.
  // Empêche la création d'un RDV dans le passé par mégarde (e.g. RDV 09:00 today
  // alors qu'il est 14:00). Backend Zod ne valide pas le futur — defense-in-depth.
  const dateTimeIsFuture = useMemo(
    () => isInFuture(dateStr, hourStr),
    [dateStr, hourStr],
  )

  const canSubmit = useMemo(
    () =>
      patientId !== null
      && dateStr.length > 0
      && hourStr.length > 0
      && dateTimeIsFuture
      && !loading,
    [patientId, dateStr, hourStr, dateTimeIsFuture, loading],
  )

  // Fix FE-11 round 1 — récap visuel "12 juin 2026 à 09:00" pour que l'user
  // confirme visuellement ce qu'il s'apprête à créer (vs juste un bouton).
  const recap = useMemo(
    () => (dateStr && hourStr ? formatRecap(dateStr, hourStr, locale) : ""),
    [dateStr, hourStr, locale],
  )

  const handleClose = useCallback(() => {
    if (loading) return // garde anti-fermeture pendant submit
    onClose()
  }, [loading, onClose])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit || patientId === null || loading) return

      const input: CreateAppointmentInput = {
        patientId,
        memberId,
        date: dateStr,
        hour: hourStr,
        durationMinutes,
        location,
        type,
        motif: motif.trim() || undefined,
      }
      const newId = await submit(input)
      if (newId !== null) {
        setSubmitFailed(false)
        onCreated(newId)
      } else {
        setSubmitFailed(true)
        setErrorNonce((n) => n + 1)
      }
    },
    [
      canSubmit,
      patientId,
      memberId,
      dateStr,
      hourStr,
      durationMinutes,
      location,
      type,
      motif,
      loading,
      submit,
      onCreated,
    ],
  )

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createDescription")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          {/* Patient combobox — search + select. Loading/error gérés en interne. */}
          <div className="grid gap-2">
            <Label htmlFor="create-patient">{t("patientLabel")}</Label>
            <PatientCombobox
              id="create-patient"
              value={patientId}
              onChange={setPatientId}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="create-date">{t("dateLabel")}</Label>
              {/* Fix FE-15 round 1 — aria-required + Fix FE-16 — aria-invalid si
                  submitFailed OU date dans le passé (validation CR-M4). */}
              <input
                type="date"
                id="create-date"
                value={dateStr}
                min={today}
                onChange={(e) => setDateStr(e.target.value)}
                required
                aria-required="true"
                aria-invalid={submitFailed || !dateTimeIsFuture ? "true" : undefined}
                disabled={loading}
                className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="create-hour">{t("hourLabel")}</Label>
              <input
                type="time"
                id="create-hour"
                value={hourStr}
                onChange={(e) => setHourStr(e.target.value)}
                required
                aria-required="true"
                aria-invalid={submitFailed || !dateTimeIsFuture ? "true" : undefined}
                disabled={loading}
                className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
              />
            </div>
          </div>

          {/* Fix CR-M4 round 1 — message d'avertissement si date+heure dans le passé. */}
          {!dateTimeIsFuture && dateStr.length > 0 && hourStr.length > 0 && (
            <p role="status" aria-live="polite" className="text-xs text-amber-700">
              {t("createDatePastWarning")}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="create-duration">{t("durationLabel")}</Label>
              <select
                id="create-duration"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                disabled={loading}
                className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
              >
                {/* Fix FE-13 round 1 — presets étendus 15→240 min. */}
                {DURATION_PRESETS.map((d) => (
                  <option key={d} value={d}>
                    {d} {t("minutesShort")}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="create-location">{t("locationLabel")}</Label>
              <select
                id="create-location"
                value={location}
                onChange={(e) => setLocation(e.target.value as Location)}
                disabled={loading}
                className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
              >
                {LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {t(`location.${loc}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="create-type">{t("typeLabel")}</Label>
            <select
              id="create-type"
              value={type}
              onChange={(e) => setType(e.target.value as AppointmentType)}
              disabled={loading}
              className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
            >
              {APPOINTMENT_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {t(`type.${tp}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="create-motif">{t("motifLabel")}</Label>
            <textarea
              id="create-motif"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              maxLength={200}
              rows={2}
              disabled={loading}
              className="border border-input rounded-md p-2 text-sm bg-background resize-none disabled:opacity-50"
              placeholder={t("motifPlaceholder")}
              aria-describedby="create-motif-help"
            />
            <p id="create-motif-help" className="text-xs text-muted-foreground">
              {motif.length} / 200 · {t("motifEncryptedNote")}
            </p>
          </div>

          {error && (
            <p
              key={`${error}-${errorNonce}`}
              role="alert"
              aria-live="assertive"
              className="text-sm text-red-600"
            >
              {/* Fix CR-H2 + HSA-3 round 1 review PR #434 — map vers clé i18n
                  distincte selon le code backend (whitelist normalisée par hook).
                  Donne au médecin un feedback actionnable vs ancien `createError`
                  générique qui poussait au re-clic en boucle. */}
              {t(errorCodeToI18nKey(error))}
            </p>
          )}

          {/* Fix FE-11 round 1 — récap visuel "12 juin 2026 à 09:00" au-dessus du
              bouton submit pour que l'user confirme visuellement le RDV qu'il
              s'apprête à créer. Pattern UX standard "confirm before commit". */}
          {recap && dateTimeIsFuture && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {t("createRecap", { datetime: recap })}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose} disabled={loading}>
              {t("actionClose")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {loading ? t("loading") : t("actionConfirmCreate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
