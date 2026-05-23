/**
 * Adapter `AppointmentListItem` API → Schedule-X event.
 *
 * Backend stocke `date` (yyyy-mm-dd) + `hour` (hh:mm:ss) séparément
 * (`@db.Date` + `@db.Time()` timezone-less). On combine en string locale
 * `"yyyy-mm-dd hh:mm"` attendue par Schedule-X (cf. docs sx events format).
 *
 * `end` calculé via `durationMinutes` (defaults 30 min si null = legacy).
 *
 * Couleurs par statut (palette Sérénité Active + glycemia clinical) :
 *   - scheduled         → teal-600 (default cabinet)
 *   - pending_validation → amber-500 (attente DOCTOR)
 *   - confirmed         → emerald-500 (validé)
 *   - cancelled         → red-500 (annulé)
 *   - completed         → gray-500 (passé)
 *   - no_show           → red-700 (no-show)
 *
 * Fix M-1 round 2 — fallback "30 min" sur durationMinutes=null aligné
 * avec defaults backend US-2505 (cf. `rdv.service` defaults).
 */

import type { AppointmentListItem } from "./useAppointments"

export interface ScheduleXEvent {
  id: string
  title: string
  start: string // "yyyy-mm-dd hh:mm"
  end: string // "yyyy-mm-dd hh:mm"
  calendarId?: string // Schedule-X calendars (color groups)
}

const STATUS_TO_CALENDAR_ID: Record<string, string> = {
  scheduled: "scheduled",
  pending_validation: "pendingValidation",
  confirmed: "confirmed",
  cancelled: "cancelled",
  completed: "completed",
  no_show: "noShow",
}

/**
 * Combine `date` (yyyy-mm-dd) + `hour` (hh:mm:ss) en `"yyyy-mm-dd hh:mm"`.
 * Renvoie null si `hour` est null (RDV sans heure = legacy, on les place
 * arbitrairement à 09:00 pour qu'ils apparaissent au début de la journée).
 */
function combineDateTime(date: string, hour: string | null): string {
  // `date` est "yyyy-mm-dd" (ou ISO complet selon serializer JSON). Normaliser.
  const datePart = date.includes("T") ? date.split("T")[0] : date
  if (!hour) return `${datePart} 09:00`
  // `hour` est "hh:mm:ss" → garde "hh:mm"
  const timePart = hour.includes("T") ? hour.split("T")[1].slice(0, 5) : hour.slice(0, 5)
  return `${datePart} ${timePart}`
}

/**
 * Fix CR-3 round 2 review PR #431 — `Date.setMinutes` natif gère le
 * rollover minuit correctement. L'ancien `% 24` perdait les RDV soirée
 * (22:00 + 180min retournait `01:00` même jour au lieu de J+1 01:00),
 * ce qui produisait `end < start` côté Schedule-X (events corrompus).
 *
 * Use `Date(Date.UTC(...))` pour éviter de dépendre de la TZ locale du
 * navigateur ; on garde le wall-clock `yyyy-mm-dd hh:mm` (cohérent avec
 * `combineDateTime` qui ne convertit pas non plus).
 */
function addMinutes(dateTime: string, minutes: number): string {
  const [datePart, timePart] = dateTime.split(" ")
  const [y, mo, d] = datePart.split("-").map(Number)
  const [h, m] = timePart.split(":").map(Number)
  const base = new Date(Date.UTC(y, mo - 1, d, h, m, 0))
  base.setUTCMinutes(base.getUTCMinutes() + minutes)
  const yy = base.getUTCFullYear()
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(base.getUTCDate()).padStart(2, "0")
  const hh = String(base.getUTCHours()).padStart(2, "0")
  const mi = String(base.getUTCMinutes()).padStart(2, "0")
  return `${yy}-${mm}-${dd} ${hh}:${mi}`
}

/**
 * Convertit un appointment API → event Schedule-X.
 *
 * Le titre est non-PHI strict (statut + ID — JAMAIS de nom patient ou
 * motif dans le rendu calendrier, le contenu sensible reste dans le modal
 * détail au clic = audit READ ciblé).
 */
export function appointmentToScheduleXEvent(appt: AppointmentListItem): ScheduleXEvent {
  const start = combineDateTime(appt.date, appt.hour)
  const durationMin = appt.durationMinutes ?? 30
  const end = addMinutes(start, durationMin)

  return {
    id: String(appt.id),
    // Title anti-PHI : statut + type seulement (pas nom patient ni motif).
    title: appt.type ? `${appt.type.toUpperCase()}` : "RDV",
    start,
    end,
    calendarId: STATUS_TO_CALENDAR_ID[appt.status] ?? "scheduled",
  }
}

/**
 * Color palette Schedule-X calendars (palette Sérénité Active).
 * Cf. https://schedule-x.dev/docs/calendar/calendars
 */
export const APPOINTMENT_CALENDARS = {
  scheduled: {
    colorName: "scheduled",
    lightColors: {
      main: "#0D9488", // teal-600 (primary)
      container: "#CCFBF1", // teal-100
      onContainer: "#134E4A", // teal-900
    },
  },
  pendingValidation: {
    colorName: "pendingValidation",
    lightColors: {
      main: "#F59E0B", // amber-500
      container: "#FEF3C7", // amber-100
      onContainer: "#78350F", // amber-900
    },
  },
  confirmed: {
    colorName: "confirmed",
    lightColors: {
      main: "#10B981", // emerald-500 (in-range glycemia)
      container: "#D1FAE5", // emerald-100
      onContainer: "#064E3B", // emerald-900
    },
  },
  cancelled: {
    colorName: "cancelled",
    lightColors: {
      main: "#EF4444", // red-500
      container: "#FEE2E2", // red-100
      onContainer: "#7F1D1D", // red-900
    },
  },
  completed: {
    colorName: "completed",
    lightColors: {
      main: "#6B7280", // gray-500
      container: "#F3F4F6", // gray-100
      onContainer: "#111827", // gray-900
    },
  },
  noShow: {
    colorName: "noShow",
    lightColors: {
      main: "#991B1B", // red-700 (very-low glycemia critical)
      container: "#FEF2F2", // red-50
      onContainer: "#7F1D1D", // red-900
    },
  },
} as const
