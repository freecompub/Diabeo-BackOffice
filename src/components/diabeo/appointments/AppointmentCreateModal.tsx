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
import { Label } from "@/components/ui/label"
import { PatientCombobox } from "./PatientCombobox"
import { useCreateAppointment, type CreateAppointmentInput } from "./useCreateAppointment"

const APPOINTMENT_TYPES = ["diabeto", "ide", "hdj", "other"] as const
const LOCATIONS = ["in_person", "video", "phone"] as const
type AppointmentType = (typeof APPOINTMENT_TYPES)[number]
type Location = (typeof LOCATIONS)[number]

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

  // Reset hook state au close (defense-in-depth — parent unmount aussi via `key`).
  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const canSubmit = useMemo(
    () => patientId !== null && dateStr.length > 0 && hourStr.length > 0 && !loading,
    [patientId, dateStr, hourStr, loading],
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
        onCreated(newId)
      } else {
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
              <input
                type="date"
                id="create-date"
                value={dateStr}
                min={today}
                onChange={(e) => setDateStr(e.target.value)}
                required
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
                disabled={loading}
                className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
              />
            </div>
          </div>

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
                <option value={15}>15 {t("minutesShort")}</option>
                <option value={30}>30 {t("minutesShort")}</option>
                <option value={45}>45 {t("minutesShort")}</option>
                <option value={60}>60 {t("minutesShort")}</option>
                <option value={90}>90 {t("minutesShort")}</option>
                <option value={120}>120 {t("minutesShort")}</option>
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
              {/* Defense-in-depth : on render UNIQUEMENT la clé i18n générique,
                  jamais le code backend brut (HSA-3 pattern iter 5). */}
              {t("createError")}
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
