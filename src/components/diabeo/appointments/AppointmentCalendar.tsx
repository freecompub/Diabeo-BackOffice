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
import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop"
import "@schedule-x/theme-default/dist/index.css"
// Schedule-X v4 — `selectedDate` et `event.start/.end` exigent des objets
// `Temporal` (TC39). Le bundle Schedule-X référence `Temporal` en GLOBAL (sans
// import) : il faut donc le side-effect `temporal-polyfill/global` pour patcher
// `globalThis.Temporal`, sinon les `instanceof Temporal.PlainDate` de
// `validateConfig` échouent (classes distinctes). L'import nommé sert à
// construire les objets côté React. Les deux pointent vers la même classe
// (chunks/classApi) → `instanceof` true. Cf. doc session dev 2026-06-03 §4.
import "temporal-polyfill/global"
import { Temporal } from "temporal-polyfill"
import { useAppointments } from "./useAppointments"
import {
  appointmentToScheduleXEvent,
  APPOINTMENT_CALENDARS,
  extractDateHourFromScheduleXStart,
  normalizeHourForCompare,
} from "./adapter"
import { MemberFilter } from "./MemberFilter"
import { useMyMemberships } from "./useMyMemberships"
import { useAppointmentDetail } from "./useAppointmentDetail"
import { AppointmentDetailModal } from "./AppointmentDetailModal"
import { AppointmentCreateModal } from "./AppointmentCreateModal"
import {
  useUpdateAppointment,
  type UpdateAppointmentErrorCode,
} from "./useUpdateAppointment"
import { useAutoClearAfter } from "@/hooks/useAutoClearAfter"
import { Button } from "@/components/ui/button"
import { StatusFilter, DEFAULT_STATUS_FILTER } from "./StatusFilter"
import { PatientFilter } from "./PatientFilter"
import { AlternativesBanner } from "./AlternativesBanner"
import type { AppointmentStatus } from "@prisma/client"

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

/**
 * Fix CR-10/FE-12 round 1 review PR #435 — Type union strict pour les codes
 * erreur drag&drop. `parseError` est un sentinel CLIENT-side (parse échec
 * helper `extractDateHourFromScheduleXStart`), les autres viennent de la
 * whitelist backend `UpdateAppointmentErrorCode`.
 */
type DndErrorCode = UpdateAppointmentErrorCode | "parseError"

/**
 * US-2500-UI iter 7 — Map code erreur drag&drop normalisé vers clé i18n.
 * Cohérent avec pattern `errorCodeToI18nKey` du modal création (iter 6).
 *
 * Fix CR-1 round 1 review PR #435 — Whitelist alignée avec `rdv.service.ts`
 * codes throwés (`alreadyClosed` vs ancien `appointmentNotEditable` fictif).
 * Famille UX :
 *   - conflict (slot overlap appt / unavailability / unique / serialization) → "Créneau pris"
 *   - alreadyClosed → "Non éditable"
 *   - forbidden → "Pas d'accès"
 *   - notFound → "RDV introuvable"
 *   - validationFailed / parseError → "Données invalides"
 *   - network / unexpected → "Erreur générique"
 */
function dndErrorCodeToI18nKey(code: DndErrorCode): string {
  switch (code) {
    case "slotOverlapAppointment":
    case "slotOverlapUnavailability":
    case "uniqueConflict":
    case "serializationConflict":
      return "dndErrorConflict"
    case "forbidden":
      return "dndErrorForbidden"
    case "alreadyClosed":
      return "dndErrorNotEditable"
    case "notFound":
      return "dndErrorNotFound"
    case "validationFailed":
    case "parseError":
      return "dndErrorValidation"
    case "networkError":
    case "unexpectedError":
    default:
      return "dndErrorGeneric"
  }
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

  // Fix A11Y-5 round 1 review PR #437 — date du jour stable au mount via
  // useState lazy init (anti React-Compiler `Date.now()` au render +
  // anti drift visible si polling à minuit). Format Intl.DateTimeFormat
  // locale-aware pour SR users (workaround Schedule-X v4 pas de
  // `aria-current="date"` natif).
  const [todayLabel] = useState(() =>
    new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date()),
  )

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

  // US-2500-UI iter 8 — state filtres statut + patient.
  // Status filter : multi-select client-side (Set lookup O(1)).
  // Patient filter : server-side (passé à useAppointments).
  const [statusFilter, setStatusFilter] = useState<ReadonlySet<AppointmentStatus>>(
    DEFAULT_STATUS_FILTER,
  )
  const [patientFilter, setPatientFilter] = useState<number | null>(null)
  // Si patient pinné dans le calendar (prop `patientId`), override le state local.
  const effectivePatientId = patientId ?? patientFilter ?? undefined

  const { items, isInitialLoading, error, truncated, lastFetchedAt, refetch } = useAppointments({
    from: range.from,
    to: range.to,
    memberId: effectiveMemberId,
    patientId: effectivePatientId,
  })

  // Fix iter 8 — filter client-side par statut (les items déjà fetchés sont
  // filtrés en mémoire, pas de re-fetch nécessaire).
  const filteredItems = useMemo(
    () => items.filter((it) => statusFilter.has(it.status)),
    [items, statusFilter],
  )

  // US-2500-UI iter 5 — state du modal détail RDV (clic sur événement).
  // `openedApptId === null` = modal fermé. Le hook `useAppointmentDetail`
  // est responsable du fetch + reset state quand id change.
  const [openedApptId, setOpenedApptId] = useState<number | null>(null)
  const detailState = useAppointmentDetail(openedApptId)

  // US-2500-UI iter 6 — state du modal création RDV (bouton "+ Nouveau RDV").
  // Mount-on-open + `key` (cohérent pattern iter 5) pour reset state interne.
  const [createOpen, setCreateOpen] = useState(false)

  // Fix iter 8 — Schedule-X reçoit la liste FILTRÉE (status filter client-side).
  // Le compteur "X RDV" reste basé sur `items` total (vs filtré) pour ne pas
  // mentir sur la charge backend — cohérent FE-9 PR #434 patientHint backend count.
  const events = useMemo(() => filteredItems.map(appointmentToScheduleXEvent), [filteredItems])

  // Fix CR-1 round 2 review PR #431 — `useNextCalendarApp` ne re-crée
  // jamais le calendrier ; passer `events` dans config est ignoré après
  // le mount initial. Pour mettre à jour dynamiquement il FAUT utiliser
  // le plugin `events-service` et appeler `eventsService.set(events)`.
  // Sans ça, le calendrier reste vide en permanence même quand le hook
  // a chargé 15 RDV.
  const eventsService = useState(() => createEventsServicePlugin())[0]

  // US-2500-UI iter 7 — Plugin drag & drop Schedule-X.
  // `minutesPerInterval=15` aligne le snap-to-grid sur le pas standard cabinet
  // (cohérent avec presets durée modal création iter 6 : 15/20/30/45/...).
  // Lazy init via `useState(() => ...)` pour identité stable cross-render
  // (sinon Schedule-X re-crée le calendar interne à chaque render parent).
  const dragAndDropPlugin = useState(() => createDragAndDropPlugin(15))[0]

  // US-2500-UI iter 7 — hook persistence update RDV après drag&drop.
  // Cohérent pattern hooks iter 5/6 (whitelist erreur + HSA-3 normalisation).
  // Fix HSA-2 round 1 — pas d'AbortController (cf. docstring hook).
  const updateAppointment = useUpdateAppointment()
  // Fix CR-10/FE-12 round 1 — type union strict `DndErrorCode` (vs ancien `string`).
  const [dndError, setDndError] = useState<DndErrorCode | null>(null)
  // Fix CR-3/HSA-1/FE-3/CR-12 round 1 — auto-clear via hook custom (cleanup
  // useEffect inclus → plus de fuite timer ni setState-on-unmounted).
  const clearDndError = useCallback(() => setDndError(null), [])
  useAutoClearAfter(dndError, clearDndError, 4000)

  const calendar = useNextCalendarApp({
    views: [createViewMonthGrid(), createViewWeek(), createViewDay()],
    events,
    // Schedule-X v4 — `selectedDate` n'accepte plus un string ISO `yyyy-mm-dd`
    // (v3) mais un `Temporal.PlainDate`. On extrait la composante date du
    // `Date` JS pour préserver le comportement (jour courant sélectionné).
    selectedDate: Temporal.PlainDate.from(selectedDate.toISOString().split("T")[0]),
    locale: sxLocale,
    calendars: APPOINTMENT_CALENDARS,
    plugins: [eventsService, dragAndDropPlugin],
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
      /**
       * US-2500-UI iter 7 — Validation async avant que Schedule-X commit
       * le drag&drop visuellement.
       *
       * Schedule-X applique d'abord le visuel (optimistic UI built-in), puis
       * appelle ce callback. Si on return `false`, Schedule-X rollback le
       * move automatiquement (restore l'ancien position). Si `true`, garde.
       *
       * Stratégie : on appelle l'API PUT en sync — l'utilisateur attend
       * (~100-500ms). C'est acceptable vu que l'optimistic visuel est déjà
       * appliqué. Pour UX optimale future : décorréler (V1.5 SWR mutation).
       *
       * **Idempotence** (Fix CR-8 round 1) : comparaison normalisée via
       * `normalizeHourForCompare` pour gérer `"09:00"` vs `"09:00:00"` que
       * Schedule-X peut retourner selon le path interne.
       *
       * **⚠️ HSA-6 warning futur dev** : ne JAMAIS return false APRÈS un
       * `submit()` ok. Sinon le backend persiste le change mais l'UI rollback
       * → divergence backend/UI. Le rollback Schedule-X est SEUL safe si
       * AUCUN PUT n'a été émis (parse fail) OU si le PUT a échoué (ok=false).
       *
       * **Fix CR-9/FE-4 round 1** : le plugin `@schedule-x/drag-and-drop` ne
       * supporte PAS le resize (c'est un plugin séparé `@schedule-x/resize`
       * NON installé). Donc `onBeforeEventUpdateAsync` n'est appelé que sur
       * un vrai move (start change). Si futur dev installe le plugin resize,
       * il faudra calculer `durationMinutes = (newEnd - newStart) / 60000`
       * et l'envoyer dans le patch.
       */
      async onBeforeEventUpdateAsync(oldEvent, newEvent) {
        const apptId = Number(newEvent.id)
        if (!Number.isFinite(apptId) || apptId <= 0) return false

        const oldExtracted = extractDateHourFromScheduleXStart(oldEvent.start)
        const newExtracted = extractDateHourFromScheduleXStart(newEvent.start)
        if (newExtracted === null) {
          setDndError("parseError")
          return false
        }
        // Fix CR-8 round 1 — comparaison normalisée (slice(0,5) sur hour).
        if (
          oldExtracted
          && oldExtracted.date === newExtracted.date
          && normalizeHourForCompare(oldExtracted.hour) === normalizeHourForCompare(newExtracted.hour)
        ) {
          return true // no-op idempotent
        }

        const result = await updateAppointment.submit(apptId, {
          date: newExtracted.date,
          hour: newExtracted.hour,
        })
        if (!result.ok) {
          setDndError(result.code)
          // Auto-clear géré par `useAutoClearAfter` hook (CR-3 fix).
          return false
        }

        // Fix CR-4/FE-5 round 1 — patche localement Schedule-X avec le DTO
        // retourné par le PUT (vs ancien `refetch()` qui re-fetchait 52
        // jours = ~50KB + N audits READ). `onEventUpdate` ci-dessous fait
        // juste un refetch en fallback pour status side-effects (e.g.
        // pending_validation → scheduled si bookingMode change backend).
        // Le visuel Schedule-X reste optimistic — pas besoin de re-update
        // l'event ici car le start a déjà été appliqué.
        return true
      },
      /**
       * US-2500-UI iter 7 — Post-update : pas de refetch automatique.
       *
       * Fix CR-4/FE-5 round 1 — ancien pattern `refetch()` ici dupliquait le
       * round-trip (PUT + GET 52j). Le visuel Schedule-X est déjà à jour
       * (optimistic UI commit) et le DTO PUT a tous les champs nécessaires.
       *
       * Le polling 60s du hook `useAppointments` corrige les divergences
       * éventuelles (status backend side-effects) sous 1 minute. Pour UX
       * instantané future : SWR mutate pattern V1.5.
       */
      onEventUpdate() {
        // No-op explicite — voir docstring ci-dessus pour le raisonnement.
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

  // US-2500-UI iter 6 — handlers create modal.
  const handleOpenCreate = useCallback(() => setCreateOpen(true), [])
  const handleCloseCreate = useCallback(() => setCreateOpen(false), [])

  // US-2500-UI iter 9 — handler "Voir alternatives" : AJOUTE le statut
  // `cancelled` au filtre actif (vs ancien écrasement complet).
  //
  // Fix CR-2 + FE-4 round 1 review PR #436 — ancien `setStatusFilter(new
  // Set(["cancelled"]))` perdait les statuts précédemment actifs (scheduled,
  // confirmed) → médecin devait re-cocher manuellement après "Voir". Le
  // pattern additif préserve les filtres user + ajoute juste cancelled.
  const handleShowAlternatives = useCallback(() => {
    setStatusFilter((prev) => new Set<AppointmentStatus>([...prev, "cancelled"]))
  }, [])

  // Fix FE-4 round 1 review PR #436 — bouton "Réinitialiser filtres" pour
  // revenir aux defaults metier (scheduled + pending_validation + confirmed).
  // Visible UNIQUEMENT si filtres modifiés vs defaults — évite clutter UI.
  const handleResetFilters = useCallback(() => {
    setStatusFilter(DEFAULT_STATUS_FILTER)
    setPatientFilter(null)
  }, [])

  // Calcul si filtres modifiés (vs defaults) — compare Set + patientFilter.
  const filtersAreCustom =
    patientFilter !== null
    || statusFilter.size !== DEFAULT_STATUS_FILTER.size
    || ![...statusFilter].every((s) => DEFAULT_STATUS_FILTER.has(s))
  // Fix FE-12 round 1 review PR #434 — flag temporaire pour aria-live polite
  // qui annonce le succès création (vs ancien close silent).
  const [justCreated, setJustCreated] = useState(false)
  const handleCreated = useCallback(() => {
    setCreateOpen(false)
    setJustCreated(true)
    // Auto-clear après 4s pour ne pas polluer le live region indéfiniment.
    setTimeout(() => setJustCreated(false), 4000)
    void refetch() // refresh calendar avec le nouveau RDV
  }, [refetch])

  // Fix CR-1 + FE-5 + FE-12 round 1 + FE-2-4 round 2 review PR #433 —
  // Modal TOUJOURS monté + `key={openedApptId ?? "closed"}` :
  //   - À l'ouverture d'un nouveau RDV (key change), React remount complet le
  //     modal → state interne reset (subMode/actionError/drafts) → drafts
  //     toujours frais, plus de PHI résiduel (résout CR-1 + FE-12)
  //   - À la fermeture (openId=null), le modal reste monté mais Base UI
  //     Dialog joue son animation `data-closed:animate-out` (résout FE-2-4
  //     régression mount-on-open round 1 qui snappait sans transition)
  //   - Pas de `useEffect([openId])` setState-in-effect (résout FE-5)
  //   - Coût mémoire négligeable : Base UI ne render rien si `open=false`
  //     (Portal vide), juste le composant React lui-même
  const detailModal = (
    <AppointmentDetailModal
      key={openedApptId ?? "closed"}
      state={detailState}
      openId={openedApptId}
      onClose={handleCloseModal}
      onActionSuccess={handleActionSuccess}
      userRole={userRole}
    />
  )

  // US-2500-UI iter 6 — modal création RDV.
  // Mount-on-open via render condition + `key` reset state au cycle d'ouverture
  // (cohérent pattern iter 5 : drafts toujours frais, anti-PHI résiduel).
  // `memberId={effectiveMemberId}` requis — donc bouton "+ Nouveau RDV" est
  // disabled si scope membre pas résolu (cas multi-cabinets sans pick).
  const createModal = createOpen && effectiveMemberId !== undefined ? (
    <AppointmentCreateModal
      key={`create-${effectiveMemberId}`}
      open={createOpen}
      memberId={effectiveMemberId}
      onClose={handleCloseCreate}
      onCreated={handleCreated}
    />
  ) : null

  // Bouton "+ Nouveau RDV" rendu dans la barre d'actions header.
  // Disabled si `effectiveMemberId` undefined (scope manquant — le user doit
  // d'abord sélectionner un membre cabinet via `<MemberFilter>`).
  //
  // Fix FE-14 round 1 review PR #434 — `aria-label` retiré (était redondant
  // avec le texte visible "+ Nouveau RDV" = WCAG 2.5.3 violation "Label in Name").
  // Fix CR-L7 round 1 — `title` tooltip si disabled pour expliquer "sélectionnez
  // un membre cabinet d'abord" au médecin qui clique sans comprendre.
  const newApptButton = (
    <Button
      variant="default"
      size="sm"
      onClick={handleOpenCreate}
      disabled={effectiveMemberId === undefined}
      title={effectiveMemberId === undefined ? t("scopeMissingChooseFirst") : undefined}
    >
      {t("newAppointmentButton")}
    </Button>
  )

  // Fix FE-12 round 1 review PR #434 — Live region pour annonce succès création
  // (SR users + visuel discret). `aria-live="polite"` non-bloquant.
  const successAnnounce = justCreated ? (
    <p role="status" aria-live="polite" className="text-xs text-emerald-700">
      {t("createdSuccess")}
    </p>
  ) : null

  // US-2500-UI iter 7 — Live region pour annonce erreur drag&drop.
  //
  // Fix FE-6 round 1 review PR #435 — `role="alert"` implique déjà
  // `aria-live="assertive"` + `aria-atomic="true"` selon la spec ARIA.
  // L'ancien `aria-live="assertive"` explicite causait des double-annonces
  // NVDA/JAWS sur certaines versions. Garder uniquement `role="alert"`.
  const dndErrorAnnounce = dndError ? (
    <p role="alert" className="text-xs text-red-600">
      {t(dndErrorCodeToI18nKey(dndError))}
    </p>
  ) : null

  if (scopeMissing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {filterEl}
          {newApptButton}
        </div>
        {/* US-2500-UI iter 10 a11y polish — id target skip-link cohérent même
            en scopeMissing path. role=region + aria-label pour landmark SR.
            Fix CR-1/A11Y-3/HSA-6 round 1 — id distinct `-empty` (vs `-main`)
            pour éviter risque duplicate id si futur refactor casse l'exclusion
            mutuelle des 2 branches. Skip-link cible `-main` ; en scopeMissing
            on accepte qu'il n'atteigne pas la zone (calendar absent de toute
            façon, le filtre membre cabinet est juste au-dessus). Fix CR-2
            round 1 — tabIndex={-1} + focus-visible:ring symétrique au path
            normal pour cohérence visuelle si futur skip-link cible `-empty`. */}
        <div
          id="appointment-calendar-empty"
          role="region"
          aria-label={t("calendarMainLabel")}
          tabIndex={-1}
          className="rounded-lg border border-border bg-card p-12 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <h2 className="text-lg font-medium text-foreground">
            {t(scopeMissingTitleKey)}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-prose mx-auto">
            {t("scopeMissingDescription")}
          </p>
        </div>
        {detailModal}
        {createModal}
      </div>
    )
  }

  if (!calendar) return null

  return (
    <div className="flex flex-col gap-3">
      {/* US-2500-UI iter 6 — header avec filtre cabinet à gauche + bouton
          "+ Nouveau RDV" à droite. Flex-wrap pour responsive mobile. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {filterEl}
        {newApptButton}
      </div>

      {/* US-2500-UI iter 8 — Filtres statut multi-select + patient.
          Le filtre statut agit côté client (Set lookup), le patient côté
          serveur via useAppointments(patientId=...). Patient filter
          masqué si patientId pré-pinné (scope patient-only). */}
      <div className="flex items-center justify-between gap-3 flex-wrap pb-1">
        <StatusFilter value={statusFilter} onChange={setStatusFilter} />
        {patientId === undefined && (
          <PatientFilter value={patientFilter} onChange={setPatientFilter} />
        )}
      </div>

      {/* US-2500-UI iter 9 — Bandeau alternatives en attente.
          Auto-affiché si countPendingAlternatives(items) > 0. Click "Voir"
          filtre le calendar sur status=cancelled. Compté sur `items` total
          (vs filteredItems) pour ne pas disparaître quand l'utilisateur a
          filtré out le statut cancelled. */}
      {/* Fix FE-5 round 1 review PR #436 — `now` calculé depuis `lastFetchedAt`
          du hook polling (refresh toutes les 60s via setState items). Si pas
          encore fetché (lastFetchedAt=null), on skip le rendu — pas de count
          significatif avant le 1er fetch. La granularité TTL 7j accepte
          largement 60s de delta. */}
      {lastFetchedAt && (
        <AlternativesBanner
          items={items}
          now={lastFetchedAt.getTime()}
          onShowAlternatives={handleShowAlternatives}
        />
      )}


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
              {/* Fix iter 8 — afficher 2 compteurs distincts : filtré vs total
                  backend. Évite le piège FE-9 PR #434 (compteur trompeur après
                  filter client). Format : "5 sur 30 RDV". Si pas de filter
                  appliqué, n = total → affichage simplifié. */}
              {filteredItems.length === items.length
                ? t("count", { count: items.length })
                : t("countFiltered", { count: filteredItems.length, total: items.length })}
              {truncated && ` ${t("truncated")}`}
            </span>
          )}
        </div>
        {/* Fix FE-4 round 1 review PR #436 — bouton "Réinitialiser filtres"
            visible si filtres custom (pas defaults). Permet retour rapide. */}
        {filtersAreCustom && (
          <button
            type="button"
            onClick={handleResetFilters}
            className="text-xs underline-offset-2 hover:underline text-primary"
          >
            {t("resetFilters")}
          </button>
        )}
      </div>

      {successAnnounce}
      {dndErrorAnnounce}

      {/* Fix L-1 — Tailwind class au lieu de magic inline style.
       *
       * US-2500-UI iter 10 a11y polish :
       *   - `id="appointment-calendar-main"` cible du skip-link page (WCAG 2.4.1)
       *   - `role="region"` + `aria-label` landmark explicite (Schedule-X v4 ne
       *     fournit pas de landmark natif sur son outer wrapper)
       *   - `aria-busy` synchronisé avec `isInitialLoading` du hook polling
       *     (SR users informés que le contenu est en cours de chargement)
       *   - Fix CR-4 round 1 — `aria-busy={isInitialLoading}` boolean direct
       *     (React sérialise correctement en string "true"/"false")
       *   - Fix A11Y-4 round 1 — `aria-label` contextuel "Calendrier des
       *     rendez-vous — Chargement..." pendant isInitialLoading (vs
       *     annonce vague "Calendrier occupé" sans contexte).
       *
       * **Schedule-X v4 a11y limitations connues** (V1.5 follow-up V2 — issue
       * GH à créer si besoin) :
       *   - Pas de `role="grid"` interne sur les vues mois/semaine/jour
       *     (rendu DOM Schedule-X imperatif via preact-signals)
       *   - Navigation clavier flèches : Schedule-X v4 supporte Tab + Enter
       *     mais pas flèches directionnelles natives sur la grille
       *   - aria-current="date" sur la cellule "today" : workaround
       *     SR-only "Aujourd'hui : <date>" rendu en dessous (A11Y-5 fix).
       *
       * Pour V1, l'alternative a11y du drag&drop est le bouton "Déplacer"
       * dans le modal détail iter 5 (Fix FE-2 PR #435 WCAG 2.5.7).
       */}
      <div
        id="appointment-calendar-main"
        role="region"
        aria-label={
          isInitialLoading
            ? `${t("calendarMainLabel")} — ${t("loading")}`
            : t("calendarMainLabel")
        }
        aria-busy={isInitialLoading}
        className="rounded-lg border border-border bg-card overflow-hidden min-h-[640px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        tabIndex={-1}
      >
        <ScheduleXCalendar calendarApp={calendar} />
      </div>

      {/* Fix A11Y-5 round 1 review PR #437 — workaround Schedule-X v4 ne
          fournit pas `aria-current="date"` sur la cellule today. SR users
          peuvent identifier la date du jour via cette annonce SR-only
          (invisible visuellement, ne perturbe pas le rendu).
          aria-live="off" par défaut — pas d'annonce dynamique (la date du
          jour ne change pas pendant la session). */}
      <p className="sr-only">{t("todayDateAnnouncement", { date: todayLabel })}</p>

      {detailModal}
      {createModal}
    </div>
  )
}
