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

import { useEffect, useMemo, useState } from "react"
import {
  ScheduleXCalendar,
  useNextCalendarApp,
} from "@schedule-x/react"
import {
  createViewMonthGrid,
  createViewWeek,
  createViewDay,
} from "@schedule-x/calendar"
import { createEventsServicePlugin } from "@schedule-x/events-service"
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
 * Calcule la range autour du mois courant pour la vue calendrier.
 *
 * Fix CR-2 round 2 review PR #431 — Backend cap `RANGE_MAX_DAYS = 62` :
 * la précédente impl (`mois ± 1 mois`) produisait 91+ jours → backend
 * retournait `rangeTooLarge` (400) systématiquement, calendrier vide
 * en permanence.
 *
 * Nouveau découpage : 7 jours avant le mois courant + tout le mois + 14
 * jours après (max ~52 jours = sous le cap). Couvre le débord visuel
 * "last days of previous month" + "first weeks of next month" rendu par
 * Schedule-X dans la vue mois.
 */
function computeRange(selectedDate: Date): { from: Date; to: Date } {
  const from = new Date(selectedDate)
  from.setUTCDate(1)
  from.setUTCHours(0, 0, 0, 0)
  // Reculer de 7 jours pour couvrir les "jours du mois précédent" affichés
  // dans la première semaine de la vue mois.
  from.setUTCDate(from.getUTCDate() - 7)

  const to = new Date(selectedDate)
  to.setUTCDate(1)
  to.setUTCHours(0, 0, 0, 0)
  // Aller au 1er du mois suivant + 14 jours pour couvrir les "premiers
  // jours du mois suivant" affichés en bas de la grille mois.
  to.setUTCMonth(to.getUTCMonth() + 1)
  to.setUTCDate(14)
  to.setUTCHours(23, 59, 59, 999)

  return { from, to }
}

export function AppointmentCalendar({
  memberId,
  patientId,
}: AppointmentCalendarProps) {
  // selectedDate change quand l'utilisateur navigue dans le calendrier.
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const range = useMemo(() => computeRange(selectedDate), [selectedDate])

  const { items, isInitialLoading, error, truncated, lastFetchedAt } = useAppointments({
    from: range.from,
    to: range.to,
    memberId,
    patientId,
  })

  const events = useMemo(() => items.map(appointmentToScheduleXEvent), [items])

  // Fix CR-1 round 2 review PR #431 — `useNextCalendarApp` ne re-crée
  // jamais le calendrier ; passer `events` dans config est ignoré après
  // le mount initial. Pour mettre à jour dynamiquement il FAUT utiliser
  // le plugin `events-service` et appeler `eventsService.set(events)`.
  // Sans ça, le calendrier reste vide en permanence même quand le hook
  // a chargé 15 RDV.
  const eventsService = useState(() => createEventsServicePlugin())[0]

  const calendar = useNextCalendarApp({
    views: [createViewMonthGrid(), createViewWeek(), createViewDay()],
    events,
    selectedDate: selectedDate.toISOString().split("T")[0],
    locale: "fr-FR",
    calendars: APPOINTMENT_CALENDARS,
    plugins: [eventsService],
    callbacks: {
      onSelectedDateUpdate(date) {
        // Schedule-X envoie un `Temporal.PlainDate` qui se coerce en
        // string ISO via `Symbol.toPrimitive` — explicite via `.toString()`
        // pour ne pas dépendre du Symbol coercion.
        const next = new Date(typeof date === "string" ? date : date.toString())
        if (next.getUTCMonth() !== selectedDate.getUTCMonth()
          || next.getUTCFullYear() !== selectedDate.getUTCFullYear()) {
          setSelectedDate(next)
        }
      },
    },
  })

  // Fix CR-1 — synchroniser events Schedule-X quand `items` change
  // (fetch initial + polling tick + navigation mois).
  useEffect(() => {
    if (!calendar) return
    eventsService.set(events)
  }, [events, calendar, eventsService])

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
      {/* Status bar — fix M-6 (isInitialLoading vs polling silent) +
          fix H-7 (stale items conservés sur erreur) + fix H-4 (i18n).
          La pluralisation FR "rendez-vous" est invariable. */}
      <div
        className="flex items-center justify-between text-xs text-muted-foreground"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          {isInitialLoading && <span>Chargement…</span>}
          {error && (
            <span role="alert" className="text-amber-700">
              Mise à jour échouée
              {lastFetchedAt && (
                <> — dernière sync à {lastFetchedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</>
              )}
            </span>
          )}
          {!isInitialLoading && !error && (
            <span>
              {items.length} rendez-vous
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
