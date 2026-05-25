/**
 * Adapter `AppointmentListItem` API → Schedule-X event.
 *
 * ## Contrat timezone (Fix H-5 round 2 review PR #431 — documentation)
 *
 * Backend stocke `date` (`@db.Date`) + `hour` (`@db.Time()`) séparément
 * **sans timezone** = wall-clock du cabinet (par convention Europe/Paris).
 *
 * L'adapter ne fait AUCUNE conversion timezone : l'heure stockée
 * "09:30" est rendue "09:30" au navigateur. Schedule-X interprète comme
 * heure locale du navigateur — donc OK tant que le DOCTOR/IDE consulte
 * depuis un fuseau aligné avec le cabinet.
 *
 * **Risque résiduel V1** : DOCTOR voyage à NYC (UTC-5) consulte calendrier
 * Paris cabinet → "09:30 Paris" affiché comme "09:30 NYC" → confusion.
 *
 * **Fix V1.5 (issue à créer)** : intégrer `HealthcareService.timezone`
 * (à ajouter au schema) + conversion `Intl.DateTimeFormat({timeZone})`
 * cohérente avec pattern PR #418 round 2 C1 (`formatDateTime` messagerie
 * et reminders RDV).
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
  /**
   * Fix US-2500-UI iter 7 — Schedule-X event options pour gater drag&drop +
   * resize sur les RDV en statuts terminaux (cancelled / completed / no_show).
   * Le médecin ne devrait pas pouvoir bouger un RDV passé/annulé — le backend
   * refuserait avec `appointmentNotEditable` mais UX = pas même proposer.
   */
  _options?: {
    disableDND?: boolean
    disableResize?: boolean
  }
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
 * Fix L-3 round 2 review PR #431 — Whitelist des types autorisés.
 * Si le backend laisse passer un `type` arbitraire (PHI accidentelle :
 * nom patient, motif...), on tombe sur "OTHER" au lieu d'afficher
 * `appt.type.toUpperCase()` raw qui leakerait dans le calendrier.
 *
 * À aligner avec la doc product des types (`AppointmentType` en
 * `appointment.service.ts:7` mais le backend route Zod accepte
 * `z.string().trim().max(50)` → tout string est autorisé).
 */
const KNOWN_APPOINTMENT_TYPES = new Set(["ide", "diabeto", "hdj"])

/**
 * Fix M-3 round 2 review PR #431 — RDV sans heure (`hour=null`) sont
 * affichés sur le calendrier avec `calendarId="unscheduled"` (couleur
 * grise rayée) pour signaler visuellement à l'utilisateur que l'heure
 * 09:00 affichée est un FALLBACK et non l'heure réelle planifiée.
 *
 * Évite la confusion clinique (DOCTOR croit RDV à 9h réel et planifie
 * dessus).
 */
const UNSCHEDULED_CALENDAR_ID = "unscheduled"

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

  // Fix L-3 — whitelist types : si type inconnu (ou PHI accidentelle),
  // afficher "OTHER" plutôt que `appt.type.toUpperCase()` raw.
  const safeType =
    appt.type && KNOWN_APPOINTMENT_TYPES.has(appt.type)
      ? appt.type.toUpperCase()
      : appt.type
        ? "OTHER"
        : "RDV"

  // Fix M-3 — RDV sans heure → calendarId "unscheduled" (visuel distinct).
  const calendarId = appt.hour === null
    ? UNSCHEDULED_CALENDAR_ID
    : STATUS_TO_CALENDAR_ID[appt.status] ?? "scheduled"

  // US-2500-UI iter 7 — disable drag&drop/resize sur RDV terminaux.
  // Le backend refuserait `appointmentNotEditable` mais UX = pas de hint visuel
  // que l'event est draggable si l'action serait rejetée.
  const isTerminal =
    appt.status === "cancelled" || appt.status === "completed" || appt.status === "no_show"
  const _options = isTerminal || appt.hour === null
    ? { disableDND: true, disableResize: true }
    : undefined

  return {
    id: String(appt.id),
    // Title anti-PHI : statut + type whitelisted seulement.
    title: safeType,
    start,
    end,
    calendarId,
    ...(_options && { _options }),
  }
}

/**
 * US-2500-UI iter 7 — Extraction de `date` (yyyy-mm-dd) et `hour` (HH:MM)
 * depuis un event Schedule-X qui a été modifié par drag&drop.
 *
 * Schedule-X v4 expose `start: Temporal.ZonedDateTime | Temporal.PlainDate`
 * dans `onEventUpdate`/`onBeforeEventUpdateAsync`. Selon que l'event était
 * timed ou all-day, le type varie.
 *
 * Format Temporal stringify :
 *   - `ZonedDateTime.toString()` → "2026-05-26T14:00:00+02:00[Europe/Paris]"
 *   - `PlainDate.toString()` → "2026-05-26"
 *   - Fallback string "yyyy-mm-dd hh:mm" si l'event vient juste de l'adapter
 *     (avant que Schedule-X le convertisse en interne).
 *
 * Retourne `null` si parsing échoue (defense-in-depth — refuse l'update
 * plutôt que d'envoyer une date corrompue au backend).
 */
export function extractDateHourFromScheduleXStart(
  start: unknown,
): { date: string; hour: string } | null {
  if (start === null || start === undefined) return null

  // String format adapter "yyyy-mm-dd hh:mm" (legacy avant conversion Temporal)
  if (typeof start === "string") {
    const match = start.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/)
    if (!match) return null
    return { date: match[1], hour: match[2] }
  }

  // Temporal-like : utilise `toString()` puis parse.
  if (typeof start === "object" && start !== null && "toString" in start) {
    const iso = String(start)
    // ZonedDateTime : "2026-05-26T14:00:00+02:00[Europe/Paris]"
    // PlainDate : "2026-05-26"
    const match = iso.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/)
    if (!match) return null
    return { date: match[1], hour: match[2] ?? "00:00" }
  }

  return null
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
  // Fix M-3 — RDV sans heure (hour=null), visuellement distinct.
  unscheduled: {
    colorName: "unscheduled",
    lightColors: {
      main: "#9CA3AF", // gray-400 (less prominent)
      container: "#F3F4F6", // gray-100
      onContainer: "#374151", // gray-700
    },
  },
} as const
