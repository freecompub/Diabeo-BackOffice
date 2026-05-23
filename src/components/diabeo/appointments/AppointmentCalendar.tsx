"use client"

/**
 * AppointmentCalendar — wrapper Schedule-X pour US-2500-UI.
 *
 * Encapsule `@schedule-x/react` derrière une API stable. En cas de
 * migration vers custom build (US-2500-UI-FALLBACK), seul ce fichier
 * change — la page `/appointments` et les modals continuent d'utiliser
 * la même prop interface.
 *
 * Itération 2 (cette PR) — fetch range query + adapter DTO → event :
 *   - Calcule range mois courant ± 1 mois (vues mois/sem/jour)
 *   - Fetch `/api/appointments?from=X&to=Y&memberId=Z` via useAppointments
 *   - Adapter `AppointmentListItem` → ScheduleXEvent via adapter.ts
 *   - Color palette Sérénité Active par statut (calendarId)
 *   - Polling 60s (cohérent dashboard medecin)
 *   - Loading + error + scopeMissing states
 *
 * Itérations à venir (mêmes PR — commits suivants) :
 *   - Modal détail (clic event) — déchiffre note/motif au open
 *   - Modal create/edit (bouton "+ Nouveau RDV")
 *   - Workflow cancel/propose-alternative/accept-alternative
 *   - Drag & drop (plugin @schedule-x/drag-and-drop)
 *   - Filtres patient / statut / membre cabinet (dropdown)
 *   - i18n complète (clés appointments.* dans fr/en/ar)
 *   - RTL arabe
 *
 * @see docs/UserStory/pro-user-stories/23-rdv/US-2500-UI-calendrier-rdv-pro.md
 * @see docs/UserStory/pro-user-stories/23-rdv/US-2500-UI-FALLBACK-custom-build.md
 */

import { useMemo, useState } from "react"
import {
  ScheduleXCalendar,
  useNextCalendarApp,
} from "@schedule-x/react"
import {
  createViewMonthGrid,
  createViewWeek,
  createViewDay,
} from "@schedule-x/calendar"
import "@schedule-x/theme-default/dist/index.css"
import { useAppointments } from "./useAppointments"
import { appointmentToScheduleXEvent, APPOINTMENT_CALENDARS } from "./adapter"

export interface AppointmentCalendarProps {
  /** Scope cabinet : RDV d'un membre healthcare-service. */
  memberId?: number
  /** Scope patient : RDV d'un patient (alternative à memberId). */
  patientId?: number
}

/**
 * Calcule la range mois courant ± 1 mois pour la vue calendrier
 * (cap à 62 jours côté backend `RANGE_MAX_DAYS`).
 */
function computeRange(selectedDate: Date): { from: Date; to: Date } {
  const from = new Date(selectedDate)
  from.setUTCDate(1)
  from.setUTCHours(0, 0, 0, 0)
  // Ouvre 1 mois avant pour couvrir l'overlap "last days of previous month"
  // affichés dans la vue mois.
  from.setUTCMonth(from.getUTCMonth() - 1)

  const to = new Date(selectedDate)
  to.setUTCDate(1)
  to.setUTCHours(0, 0, 0, 0)
  // Ouvre +1 mois après le mois courant.
  to.setUTCMonth(to.getUTCMonth() + 2)
  // -1 ms pour rester < to (date exclusive côté backend).
  to.setUTCMilliseconds(-1)

  return { from, to }
}

export function AppointmentCalendar({
  memberId,
  patientId,
}: AppointmentCalendarProps) {
  // selectedDate change quand l'utilisateur navigue dans le calendrier.
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const range = useMemo(() => computeRange(selectedDate), [selectedDate])

  const { items, loading, error, truncated } = useAppointments({
    from: range.from,
    to: range.to,
    memberId,
    patientId,
  })

  const events = useMemo(() => items.map(appointmentToScheduleXEvent), [items])

  const calendar = useNextCalendarApp({
    views: [createViewMonthGrid(), createViewWeek(), createViewDay()],
    events,
    selectedDate: selectedDate.toISOString().split("T")[0],
    locale: "fr-FR",
    calendars: APPOINTMENT_CALENDARS,
    callbacks: {
      onSelectedDateUpdate(date) {
        // Schedule-X envoie "yyyy-mm-dd" — refetch range si changement de mois.
        const next = new Date(date)
        if (next.getUTCMonth() !== selectedDate.getUTCMonth()
          || next.getUTCFullYear() !== selectedDate.getUTCFullYear()) {
          setSelectedDate(next)
        }
      },
    },
  })

  // Scope missing — message UX clair (à remplacer par filtre cabinet dans
  // l'itération suivante).
  const scopeMissing = memberId === undefined && patientId === undefined
  if (scopeMissing) {
    return (
      <div className="rounded-lg border border-border bg-card p-12 text-center">
        <h2 className="text-lg font-medium text-foreground">
          Sélectionnez un filtre
        </h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-prose mx-auto">
          Pour afficher le calendrier, sélectionnez un membre cabinet (DOCTOR/NURSE)
          ou un patient. Filtres dropdown disponibles dans la prochaine itération.
        </p>
      </div>
    )
  }

  if (!calendar) return null

  return (
    <div className="flex flex-col gap-3">
      {/* Status bar minimal — loading / error / truncated */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          {loading && <span aria-live="polite">Chargement…</span>}
          {error && (
            <span role="alert" className="text-red-600">
              Erreur : {error}
            </span>
          )}
          {!loading && !error && (
            <span aria-live="polite">
              {items.length} rendez-vous{items.length > 1 ? "s" : ""}
              {truncated && " (résultats tronqués — affinez la plage)"}
            </span>
          )}
        </div>
      </div>

      <div
        className="rounded-lg border border-border bg-card overflow-hidden"
        style={{ minHeight: "640px" }}
      >
        <ScheduleXCalendar calendarApp={calendar} />
      </div>
    </div>
  )
}
