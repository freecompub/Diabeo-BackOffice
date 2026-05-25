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

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
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
import { MemberFilter } from "./MemberFilter"
import { useMyMemberships } from "./useMyMemberships"
import { useAppointmentDetail } from "./useAppointmentDetail"
import { AppointmentDetailModal } from "./AppointmentDetailModal"

/**
 * Fix M-10 round 2 review PR #431 — Locale Schedule-X dynamique selon
 * la locale active next-intl (fr/en/ar). RTL pour arabe à valider
 * post-merge (Schedule-X v4 supporte `ar-DZ` natif depuis v4.1).
 */
const SX_LOCALE_BY_NEXTINTL: Record<string, string> = {
  fr: "fr-FR",
  en: "en-US",
  ar: "ar-DZ",
}

export interface AppointmentCalendarProps {
  /**
   * Scope cabinet initial passé en prop (override le filtre interne).
   * Si undefined, le composant utilise `<MemberFilter>` pour résoudre
   * via `/api/account/me-memberships` (auto-select si 1 seul membership).
   */
  memberId?: number
  /** Scope patient : RDV d'un patient (alternative à memberId). */
  patientId?: number
  /**
   * Rôle utilisateur courant — injecté par la page server-component
   * (lecture directe du JWT via `requireAuth`). Utilisé pour gater le
   * bouton "Proposer alternative" du modal détail (DOCTOR+ uniquement).
   *
   * US-2500-UI iter 5 — éviter un round-trip `/api/account` côté client
   * juste pour le rôle.
   */
  userRole: "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"
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
  memberId: memberIdProp,
  patientId,
  userRole,
}: AppointmentCalendarProps) {
  const t = useTranslations("appointments")
  const locale = useLocale()
  const sxLocale = SX_LOCALE_BY_NEXTINTL[locale] ?? "fr-FR"

  // selectedDate change quand l'utilisateur navigue dans le calendrier.
  // Fix M-5 — `useState(() => new Date())` lazy initializer pour éviter
  // de re-créer Date à chaque render (et stable strict-mode double-render).
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date())
  const range = useMemo(() => computeRange(selectedDate), [selectedDate])

  // US-2500-UI iter 4 — état du filtre membre cabinet.
  // Fix CR-1 + H-4 round 2 review PR #432 — `useMyMemberships` est appelé
  // dans le parent (vs auparavant dans `<MemberFilter>`) pour éviter le
  // double mount/fetch (le filter était rendu dans 2 branches return
  // distinctes → unmount/remount à chaque transition scopeMissing).
  const memberships = useMyMemberships()
  // `pickedMemberId` = choix explicite user via dropdown (controlled value).
  // Reste `null` tant que user n'a pas cliqué — auto-resolve via dérivation.
  const [pickedMemberId, setPickedMemberId] = useState<number | null>(null)

  // Fix React-Compiler lint — éviter `setState` synchronously dans useEffect
  // (cascading renders warning). On dérive `effectiveMemberId` au render au
  // lieu de stocker le résultat dans un state séparé synchronisé via effect.
  // Couvre :
  //   - prop override (parent injecte memberId)
  //   - user pick (pickedMemberId) avec sanitization staleness
  //   - auto-resolve si exactement 1 membership (cas DOCTOR/NURSE le plus courant)
  // Fix H-2 round 2 — sanitize si pick pointe vers un memberId disparu
  // (cas rare : admin retire affectation pendant la session).
  const effectiveMemberId = useMemo<number | undefined>(() => {
    if (memberIdProp !== undefined) return memberIdProp
    // Si user a fait un pick explicite ET qu'il est encore dans la liste, on garde.
    if (
      pickedMemberId !== null
      && memberships.items.some((m) => m.memberId === pickedMemberId)
    ) {
      return pickedMemberId
    }
    // Auto-resolve : exactement 1 membership → on l'utilise directement.
    // (HealthcareMember.userId @unique au schema actuel = N=1 quasi-toujours.)
    if (!memberships.loading && !memberships.error && memberships.items.length === 1) {
      return memberships.items[0].memberId
    }
    return undefined
  }, [
    memberIdProp,
    pickedMemberId,
    memberships.items,
    memberships.loading,
    memberships.error,
  ])

  // Value affichée dans `<MemberFilter>` — soit le pick valide, soit l'auto-resolve
  // (pour que le dropdown ≥ 2 reflète bien le défaut). Si effectiveMemberId est
  // `undefined`, le dropdown reste vide (placeholder).
  const filterValue = effectiveMemberId ?? null

  const { items, isInitialLoading, error, truncated, lastFetchedAt, refetch } = useAppointments({
    from: range.from,
    to: range.to,
    memberId: effectiveMemberId,
    patientId,
  })

  // US-2500-UI iter 5 — state du modal détail RDV (clic sur événement).
  // `openedApptId === null` = modal fermé. Le hook `useAppointmentDetail`
  // est responsable du fetch + reset state quand id change.
  const [openedApptId, setOpenedApptId] = useState<number | null>(null)
  const detailState = useAppointmentDetail(openedApptId)

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
    locale: sxLocale,
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
      // US-2500-UI iter 5 — clic sur événement ouvre le modal détail.
      // `event.id` est le string id de l'adapter (cf. adapter.ts `String(appt.id)`).
      onEventClick(event) {
        const parsed = Number(event.id)
        if (Number.isFinite(parsed) && parsed > 0) {
          setOpenedApptId(parsed)
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

  // US-2500-UI iter 4 — Empty state si aucun scope résolu (memberId+patientId
  // tous deux undefined, le filtre cabinet n'a rien remonté ou pas encore résolu).
  const scopeMissing = effectiveMemberId === undefined && patientId === undefined

  // Le `<MemberFilter>` est toujours rendu (sauf si patientId-only scope) pour
  // que l'utilisateur puisse switcher de cabinet.
  const showMemberFilter = memberIdProp === undefined && patientId === undefined

  // Fix CR-1 round 2 review PR #432 — `<MemberFilter>` rendu UNE SEULE FOIS
  // en haut du tree, pas dans 2 branches return distinctes. Évite le
  // double mount/fetch.
  const filterEl = showMemberFilter ? (
    <MemberFilter
      items={memberships.items}
      loading={memberships.loading}
      error={memberships.error}
      value={filterValue}
      onMemberChange={setPickedMemberId}
      onRetry={memberships.refetch}
    />
  ) : null

  // Fix M-10 round 2 — message contextualisé : si ≥2 memberships, le user
  // doit choisir activement ; si 0, il n'a rien à faire.
  const scopeMissingTitleKey =
    memberships.items.length >= 2
      ? "scopeChooseTitle"
      : "scopeMissingTitle"

  // US-2500-UI iter 5 — handlers stables pour le modal détail.
  // Fix FE-6 round 1 review PR #433 — `useCallback` pour identité stable :
  // les handlers passés en props au modal ne sont plus recréés à chaque
  // render parent (cohérent si le modal devient `React.memo` plus tard).
  const handleCloseModal = useCallback(() => setOpenedApptId(null), [])
  // Refetch la liste après une action (cancel / proposeAlt) pour
  // que le calendrier reflète immédiatement le nouveau statut.
  const handleActionSuccess = useCallback(() => { void refetch() }, [refetch])

  // Fix CR-1 + FE-5 + FE-7 + FE-12 round 1 review PR #433 — mount-on-open :
  // le modal n'est rendu QUE lorsque `openedApptId !== null` + clé reset
  // chaque ouverture pour invalider le state interne (sub-mode, drafts cancelReason
  // / dateStr / timeStr) → résout :
  //   - CR-1 : réouverture du même RDV ne montre plus l'ancien sub-mode
  //   - FE-5 : plus de `setState in useEffect` anti-pattern dans le modal
  //   - FE-7 : pas de coût React render quand modal fermé
  //   - FE-12 : drafts toujours frais à l'ouverture
  const detailModal = openedApptId !== null ? (
    <AppointmentDetailModal
      key={openedApptId}
      state={detailState}
      openId={openedApptId}
      onClose={handleCloseModal}
      onActionSuccess={handleActionSuccess}
      userRole={userRole}
    />
  ) : null

  if (scopeMissing) {
    return (
      <div className="flex flex-col gap-3">
        {filterEl}
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <h2 className="text-lg font-medium text-foreground">
            {t(scopeMissingTitleKey)}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-prose mx-auto">
            {t("scopeMissingDescription")}
          </p>
        </div>
        {detailModal}
      </div>
    )
  }

  if (!calendar) return null

  return (
    <div className="flex flex-col gap-3">
      {filterEl}

      {/* Status bar — fix M-6 (isInitialLoading silent polling) +
          fix H-7 (stale items conservés sur erreur) +
          fix H-4 (i18n ICU plural correct, "rendez-vous" invariable FR). */}
      <div
        className="flex items-center justify-between text-xs text-muted-foreground"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          {isInitialLoading && <span>{t("loading")}</span>}
          {error && (
            <span role="alert" className="text-amber-700">
              {lastFetchedAt
                ? t("errorWithSync", {
                    time: lastFetchedAt.toLocaleTimeString(sxLocale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })
                : t("errorNoSync")}
            </span>
          )}
          {!isInitialLoading && !error && (
            <span>
              {t("count", { count: items.length })}
              {truncated && ` ${t("truncated")}`}
            </span>
          )}
        </div>
      </div>

      {/* Fix L-1 — Tailwind class au lieu de magic inline style. */}
      <div className="rounded-lg border border-border bg-card overflow-hidden min-h-[640px]">
        <ScheduleXCalendar calendarApp={calendar} />
      </div>

      {detailModal}
    </div>
  )
}
