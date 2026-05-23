"use client"

/**
 * AppointmentCalendar — wrapper Schedule-X pour US-2500-UI.
 *
 * Encapsule `@schedule-x/react` derrière une API stable. En cas de
 * migration vers custom build (US-2500-UI-FALLBACK), seul ce fichier
 * change — la page `/appointments` et les modals continuent d'utiliser
 * la même prop interface.
 *
 * Étape scaffold (PR initiale) :
 *   - Calendrier vide avec vues mois/semaine/jour
 *   - Locale FR par défaut (i18n complète + RTL ar dans commits suivants)
 *   - Pas de fetch API (mock data vide)
 *
 * Itérations à venir (mêmes PR) :
 *   - Fetch `/api/appointments?from=X&to=Y&memberId=Z` (range query)
 *   - Filtres patient / statut / membre cabinet
 *   - Modal détail (clic event) — déchiffre note/motif au open
 *   - Modal create/edit (bouton "+ Nouveau RDV")
 *   - Workflow cancel/propose-alternative/accept-alternative
 *   - Drag & drop (plugin @schedule-x/drag-and-drop)
 *
 * @see docs/UserStory/pro-user-stories/23-rdv/US-2500-UI-calendrier-rdv-pro.md
 * @see docs/UserStory/pro-user-stories/23-rdv/US-2500-UI-FALLBACK-custom-build.md
 */

import { useState } from "react"
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

/**
 * Composant calendrier appointments — scaffold initial.
 *
 * TODO commits suivants même PR :
 *   - Props `from / to / memberId / statusFilter` + range query API
 *   - `onEventClick` → ouvre modal détail (audit READ ciblé)
 *   - `onSelectedDateUpdate` → refetch quand changement mois
 *   - i18n complète (clés appointments.* dans fr/en/ar)
 */
export function AppointmentCalendar() {
  const [events] = useState<Array<{ id: string; title: string; start: string; end: string }>>([])

  const calendar = useNextCalendarApp({
    views: [createViewMonthGrid(), createViewWeek(), createViewDay()],
    events,
    selectedDate: new Date().toISOString().split("T")[0],
    locale: "fr-FR",
  })

  if (!calendar) return null

  return (
    <div
      className="rounded-lg border border-border bg-card overflow-hidden"
      // sx-react wrapper attend une hauteur explicite pour le calc grid
      style={{ minHeight: "640px" }}
    >
      <ScheduleXCalendar calendarApp={calendar} />
    </div>
  )
}
