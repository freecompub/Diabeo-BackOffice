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
 * (`@db.Date` + `@db.Time()` timezone-less). On combine en
 * `Temporal.ZonedDateTime` (Schedule-X v4 — l'ancien string
 * `"yyyy-mm-dd hh:mm"` v3 est rejeté par `validateEvents`).
 *
 * `end` calculé via `durationMinutes` (defaults 30 min si null = legacy),
 * additionné nativement par `ZonedDateTime.add` (rollover géré).
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

import { Temporal } from "temporal-polyfill"
import type { AppointmentListItem } from "./useAppointments"

export interface ScheduleXEvent {
  id: string
  title: string
  /**
   * Schedule-X v4 — `start`/`end` doivent être des `Temporal.ZonedDateTime`
   * (events "timed") ou `Temporal.PlainDate` (all-day). On utilise toujours
   * `ZonedDateTime` ici (les RDV ont une heure ou un fallback 09:00).
   *
   * v3 utilisait un string `"yyyy-mm-dd hh:mm"` — `validateEvents`
   * (`core.js`) le rejette désormais. Cf. doc session dev 2026-06-03 §5.
   */
  start: Temporal.ZonedDateTime
  end: Temporal.ZonedDateTime
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
 * Combine `date` (yyyy-mm-dd) + `hour` (hh:mm:ss) en un
 * `Temporal.ZonedDateTime` (Schedule-X v4).
 *
 * RDV sans heure (`hour=null`, legacy) → fallback 09:00 pour qu'ils
 * apparaissent en début de journée (signalés visuellement via
 * `calendarId="unscheduled"`, cf. `UNSCHEDULED_CALENDAR_ID`).
 *
 * **Timezone wall-clock contract (cf. en-tête de fichier H-5)** : on
 * construit le `ZonedDateTime` sur la timezone du navigateur
 * (`Temporal.Now.timeZoneId()`) en y plaquant l'heure stockée telle quelle
 * ("09:30" stocké → "09:30" affiché). Aucune conversion. V1.5 :
 * `HealthcareService.timezone` quand le schema l'introduira.
 */
function combineDateTime(date: string, hour: string | null): Temporal.ZonedDateTime {
  // `date` est "yyyy-mm-dd" (ou ISO complet selon serializer JSON). Normaliser.
  const datePart = date.includes("T") ? date.split("T")[0] : date
  // `hour` est "hh:mm:ss" (ou ISO complet) → garde "hh:mm". Fallback 09:00.
  const timePart = !hour
    ? "09:00"
    : hour.includes("T")
      ? hour.split("T")[1].slice(0, 5)
      : hour.slice(0, 5)
  // `PlainDateTime.from` exige un séparateur "T" ISO strict (pas l'espace v3).
  return Temporal.PlainDateTime.from(`${datePart}T${timePart}`).toZonedDateTime(
    Temporal.Now.timeZoneId(),
  )
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
  // `ZonedDateTime.add` gère nativement le rollover minuit/mois/année
  // (ex: 22:00 + 180min → J+1 01:00) — plus de calcul manuel `% 24`
  // (ancien fix CR-3 round 2 PR #431 désormais couvert par Temporal).
  const end = start.add({ minutes: durationMin })

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
  // Le backend refuse `alreadyClosed` (422) — UX = pas de hint visuel
  // que l'event est draggable si l'action serait rejetée.
  //
  // Fix CR-6 round 1 review PR #435 — `hour === null` (RDV unscheduled
  // placé en fallback 09:00) reste **draggable** : c'est précisément
  // l'action qui résout le bug "RDV sans heure" — le médecin drag le
  // RDV pour lui donner une heure réelle. Si on bloquait, le seul moyen
  // de fixer un RDV unscheduled serait d'ouvrir le modal détail puis
  // utiliser le sub-mode "Déplacer" (V1.5 FE-2 WCAG 2.5.7 alternative).
  const isTerminal =
    appt.status === "cancelled" || appt.status === "completed" || appt.status === "no_show"
  const _options = isTerminal
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
 * Fix CR-5 round 1 review PR #435 — Regex avec **bornes valides** :
 *   - année : 1900-2999 (validation lâche — backend valide précis)
 *   - mois : 01-12
 *   - jour : 01-31 (validation calendaire fine déférée au backend — pas 30 février)
 *   - heure : 00-23 (si présente)
 *   - minute : 00-59 (si présente)
 *
 * Pattern : date OBLIGATOIRE. Si un séparateur ` ` ou `T` suit, alors heure
 * + minute DOIVENT être valides (sinon return null — defense-in-depth contre
 * formats inattendus type "24:60" qui faisaient fallback "00:00" silent).
 *
 * 2 regex distinctes pour faire le check en 2 passes :
 *   1. Match date-only (optionnel séparateur + heure)
 *   2. Si séparateur présent, heure DOIT valid avec regex stricte
 */
const ISO_DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])([ T])?(.*)$/
const ISO_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)/

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
 *
 * **Timezone wall-clock contract (HSA-4 V1.5)** : on extrait les composantes
 * ISO du `toString()` Temporal — c'est l'heure WALL-CLOCK affichée par
 * Schedule-X. Si le navigateur du médecin tourne dans un fuseau différent
 * du cabinet, l'heure stockée backend peut être décalée. Tracker
 * V1.5 : `HealthcareService.timezone` schema + bannière UI mismatch.
 */
export function extractDateHourFromScheduleXStart(
  start: unknown,
): { date: string; hour: string } | null {
  if (start === null || start === undefined) return null

  let iso: string
  if (typeof start === "string") {
    iso = start
  } else if (typeof start === "object" && "toString" in start) {
    iso = String(start)
  } else {
    return null
  }

  const dateMatch = iso.match(ISO_DATE_RE)
  if (!dateMatch) return null
  const [, y, mo, d, sep, rest] = dateMatch
  const date = `${y}-${mo}-${d}`

  // Pas de séparateur = PlainDate (RDV all-day) → fallback hour "00:00"
  if (!sep) return { date, hour: "00:00" }

  // Séparateur présent → heure DOIT être valide (defense-in-depth CR-5).
  const timeMatch = rest.match(ISO_TIME_RE)
  if (!timeMatch) return null
  return { date, hour: `${timeMatch[1]}:${timeMatch[2]}` }
}

/**
 * Fix CR-8 round 1 review PR #435 — normalise une chaîne d'heure pour
 * comparaison idempotente. Schedule-X peut retourner `"09:00"` OU `"09:00:00"`
 * selon le path interne — sans normalisation, l'idempotence comparait des
 * formats différents et envoyait un PUT inutile + audit fantôme.
 */
export function normalizeHourForCompare(hour: string | null): string {
  if (hour === null) return ""
  return hour.slice(0, 5) // "HH:MM" — strip seconds + millisec si présents
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
