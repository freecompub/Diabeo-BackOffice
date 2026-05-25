"use client"

/**
 * MyAppointmentsList — liste chronologique des RDV du patient connecté.
 *
 * US-2500-UI iter 12 — surface web complémentaire de l'app iOS Diabeo.
 *
 * **Fetch** : `useAppointments({ patientId, memberId: undefined, ... })` —
 * range -30j → +90j (couvre prochains + récents passés). Backend RBAC
 * VIEWER → own patient uniquement (US-2200 access control + B1 round 1
 * review PR #438 abaisse `/api/appointments` GET à VIEWER avec garde
 * `canAccessPatient` enforce ownership).
 *
 * **UI** :
 *   - Sections "Prochains" (>= today) + "Passés" (< today)
 *   - Tri chronologique : prochains croissant, passés décroissant
 *   - Bouton "Accepter alternative" si status=cancelled + propAlt set
 *   - Badge statut couleurs Sérénité Active
 *
 * **A11y** :
 *   - Sections h2 avec landmark `<section aria-labelledby>`
 *   - aria-live="polite" + aria-atomic sur les actions accept (Fix H8 PR #438)
 *   - Touch targets boutons ≥ 44px
 *   - Badge contraste WCAG AA (Fix H7 PR #438 — amber-600 + font-semibold)
 *
 * **Pattern hooks** : réutilise `useAppointments` (iter 1) +
 * `useAcceptAlternative` (iter 9 — pattern HSA-3 whitelist + mountedRef).
 *
 * **Fixes round 1 review PR #438** :
 *   - H1 : `nowMs` refresh via `lastFetchedAt` (vs snapshot lazy au mount)
 *   - H2 : `submittingId` per-card (vs `acceptAltHook.loading` global qui
 *     disable toutes les cards)
 *   - H3 : `mountedRef` pour gate `setActionMessage` après unmount
 *   - M3 : map `code` → i18n key dédié (vs message générique unique)
 *   - M5 : `AppointmentCard` extrait + `React.memo`
 *   - M11 : `range` recompute si `lastFetchedAt` > 6h écart
 *   - L1 : `STATUS_BADGE_VARIANT` typé `Record<AppointmentStatus, ...>`
 *   - L3 : `localeCompare` ISO remplacé par `Date.getTime()` (defensive)
 *   - L4 : `hourLabel` regex match (vs `.slice(0, 5)` non-défensif)
 *   - L13 : `toLocaleTimeString` wrapped in try/catch (locale invalide)
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import type { AppointmentStatus } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAppointments } from "./useAppointments"
import { useAcceptAlternative, type AcceptAlternativeErrorCode } from "./useAcceptAlternative"
import { useAutoClearAfter } from "@/hooks/useAutoClearAfter"
import type { AppointmentListItem } from "./useAppointments"

export interface MyAppointmentsListProps {
  /** patient.id du VIEWER connecté (résolu par la page server-component). */
  patientId: number
}

/**
 * Fix L1 round 1 review PR #438 — `Record<AppointmentStatus, ...>` au lieu
 * de `Record<string, ...>` → si Prisma ajoute un nouveau status, TS échoue.
 */
const STATUS_BADGE_VARIANT: Record<AppointmentStatus, "default" | "secondary" | "destructive" | "outline"> = {
  scheduled: "default",
  pending_validation: "outline",
  confirmed: "default",
  cancelled: "destructive",
  completed: "secondary",
  no_show: "destructive",
}

/**
 * Fix M3 round 1 review PR #438 — map code erreur → clé i18n dédiée.
 * Patient voit un message actionnable (vs message générique unique).
 */
function acceptErrorI18nKey(code: AcceptAlternativeErrorCode): string {
  switch (code) {
    case "alternativeExpired":
      return "myAppointmentsAcceptError.deadlineExceeded"
    case "slotOverlapAppointment":
    case "slotOverlapUnavailability":
    case "uniqueConflict":
    case "serializationConflict":
      return "myAppointmentsAcceptError.conflict"
    case "notCancelled":
    case "noAlternative":
      return "myAppointmentsAcceptError.alreadyHandled"
    case "forbidden":
    case "notFound":
      return "myAppointmentsAcceptError.notAllowed"
    case "networkError":
      return "myAppointmentsAcceptError.network"
    default:
      return "myAppointmentsAcceptError.generic"
  }
}

/** Range fetch : 30j passé → 90j futur (couvre prochains + historique récent). */
function computePatientRange(now: number): { from: Date; to: Date } {
  const from = new Date(now)
  from.setDate(from.getDate() - 30)
  from.setUTCHours(0, 0, 0, 0)
  const to = new Date(now)
  to.setDate(to.getDate() + 90)
  to.setUTCHours(23, 59, 59, 999)
  return { from, to }
}

const RANGE_REFRESH_THRESHOLD_MS = 6 * 3600 * 1000
const NOW_REFRESH_INTERVAL_MS = 10 * 60 * 1000

/** Format heure défensif (HH:MM:SS attendu, fallback si format inattendu). */
function formatHour(raw: string | null): string | null {
  if (!raw) return null
  const m = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return raw
  return `${m[1].padStart(2, "0")}:${m[2]}`
}

/** Tri ISO robuste — Date.getTime() au lieu de localeCompare (L3 FE PR #438). */
function compareDateAsc(a: AppointmentListItem, b: AppointmentListItem): number {
  return new Date(a.date).getTime() - new Date(b.date).getTime()
}

export function MyAppointmentsList({ patientId }: MyAppointmentsListProps) {
  const t = useTranslations("appointments")
  const locale = useLocale()

  // Fix H1 + M11 round 1 review PR #438 — `nowMs` réfreshable, déclenche
  // recompute range si écart > 6h (page laissée ouverte longtemps).
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [rangeBase, setRangeBase] = useState<number>(() => Date.now())

  // Refresh `nowMs` toutes les 10min (split prochains/passés cohérent).
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), NOW_REFRESH_INTERVAL_MS)
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        setNowMs(Date.now())
      }
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible)
    }
    return () => {
      clearInterval(id)
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible)
      }
    }
  }, [])

  // Range recompute si écart > 6h (range glisse, refetch).
  useEffect(() => {
    if (Math.abs(nowMs - rangeBase) > RANGE_REFRESH_THRESHOLD_MS) {
      setRangeBase(nowMs)
    }
  }, [nowMs, rangeBase])

  const range = useMemo(() => computePatientRange(rangeBase), [rangeBase])
  const { items, isInitialLoading, error, lastFetchedAt, refetch } = useAppointments({
    from: range.from,
    to: range.to,
    patientId,
  })

  // Fix H3 round 1 review PR #438 — `mountedRef` pour gate `setActionMessage`.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Fix H2 round 1 review PR #438 — `submittingId` per-card (vs `loading` global).
  const [submittingId, setSubmittingId] = useState<number | null>(null)

  const acceptAltHook = useAcceptAlternative()
  // Fix M3 CR round 1 review PR #438 — extraire `submit` (stable via useCallback)
  // pour deps array stable. `acceptAltHook` object change ref chaque render.
  const acceptSubmit = acceptAltHook.submit

  const [actionMessage, setActionMessage] = useState<{
    kind: "success" | "error"
    code: AcceptAlternativeErrorCode | "success"
    apptId: number
  } | null>(null)
  const clearAction = useCallback(() => {
    if (mountedRef.current) setActionMessage(null)
  }, [])
  useAutoClearAfter(actionMessage, clearAction, 4000)

  const handleAccept = useCallback(
    async (apptId: number) => {
      // Fix H2 round 1 review PR #438 — guard double-submit (même card).
      if (submittingId !== null) return
      setSubmittingId(apptId)
      try {
        const result = await acceptSubmit(apptId)
        if (!mountedRef.current) return
        if (result.ok) {
          setActionMessage({ kind: "success", code: "success", apptId })
          void refetch()
        } else {
          setActionMessage({ kind: "error", code: result.code, apptId })
        }
      } finally {
        if (mountedRef.current) setSubmittingId(null)
      }
    },
    [acceptSubmit, refetch, submittingId],
  )

  // Split chronologique : prochains (>= today) vs passés (< today).
  const { upcoming, past } = useMemo(() => {
    const todayMs = nowMs - 12 * 3600 * 1000 // tolérance demi-journée
    const up: AppointmentListItem[] = []
    const ps: AppointmentListItem[] = []
    for (const it of items) {
      const dt = new Date(it.date).getTime()
      if (dt >= todayMs) up.push(it)
      else ps.push(it)
    }
    up.sort(compareDateAsc) // proche en haut
    ps.sort((a, b) => -compareDateAsc(a, b)) // récent en haut
    return { upcoming: up, past: ps }
  }, [items, nowMs])

  if (isInitialLoading) {
    return (
      <div
        id="my-appointments-list"
        role="status"
        aria-busy="true"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        {t("loading")}
      </div>
    )
  }
  if (error) {
    // Fix L13 round 1 review PR #438 — try/catch toLocaleTimeString (locale invalide).
    let timeStr: string | null = null
    if (lastFetchedAt) {
      try {
        timeStr = lastFetchedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      } catch {
        timeStr = lastFetchedAt.toISOString().slice(11, 16)
      }
    }
    return (
      <div
        id="my-appointments-list"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="rounded-md border border-red-600 bg-red-50 p-4 text-sm text-red-900"
      >
        {t("myAppointmentsError")}
        {timeStr && (
          <span className="ml-2 text-xs text-muted-foreground">
            ({t("lastSync", { time: timeStr })})
          </span>
        )}
      </div>
    )
  }

  return (
    <div id="my-appointments-list" className="flex flex-col gap-6">
      {/* Fix H8 round 1 review PR #438 — aria-atomic="true" : NVDA/JAWS
          re-vocalisent le message complet si mise à jour DOM partielle. */}
      {actionMessage && (
        <div
          role={actionMessage.kind === "error" ? "alert" : "status"}
          aria-live={actionMessage.kind === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          className={
            actionMessage.kind === "success"
              ? "rounded-md border border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-900"
              : "rounded-md border border-red-600 bg-red-50 p-3 text-sm text-red-900"
          }
        >
          {actionMessage.kind === "success"
            ? t("myAppointmentsAcceptOk")
            : t(acceptErrorI18nKey(actionMessage.code as AcceptAlternativeErrorCode))}
        </div>
      )}

      <section aria-labelledby="my-appointments-upcoming-heading">
        <h2 id="my-appointments-upcoming-heading" className="text-lg font-medium mb-3">
          {t("myAppointmentsUpcoming", { count: upcoming.length })}
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("myAppointmentsUpcomingEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((it) => (
              <AppointmentCard
                key={it.id}
                item={it}
                locale={locale}
                onAccept={handleAccept}
                submitting={submittingId === it.id}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="my-appointments-past-heading">
        <h2 id="my-appointments-past-heading" className="text-lg font-medium mb-3">
          {t("myAppointmentsPast", { count: past.length })}
        </h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("myAppointmentsPastEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {past.map((it) => (
              <AppointmentCard
                key={it.id}
                item={it}
                locale={locale}
                onAccept={handleAccept}
                submitting={submittingId === it.id}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/* ─── AppointmentCard ───────────────────────────────────────────── */

interface AppointmentCardProps {
  item: AppointmentListItem
  locale: string
  onAccept: (id: number) => void
  /** Fix H2 round 1 review PR #438 — état per-card, pas global. */
  submitting: boolean
}

/**
 * Fix M5 round 1 review PR #438 — `React.memo` pour éviter re-render N×items
 * à chaque polling tick `useAppointments` (60s). Compare via item.id + status.
 */
const AppointmentCard = memo(function AppointmentCard({
  item,
  locale,
  onAccept,
  submitting,
}: AppointmentCardProps) {
  const t = useTranslations("appointments")

  // Format wall-clock cohérent contrat US-2500-UI (timeZone: UTC, vs runtime).
  const dateLabel = useMemo(() => {
    try {
      const datePart = item.date.includes("T") ? item.date.split("T")[0] : item.date
      const [y, m, d] = datePart.split("-").map(Number)
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
        return item.date.slice(0, 10)
      }
      return new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(y, m - 1, d)))
    } catch {
      // L3 round 1 review PR #438 — fallback lisible (vs ISO brut).
      return item.date.slice(0, 10)
    }
  }, [item.date, locale])

  const hourLabel = formatHour(item.hour)
  const canAcceptAlt = item.status === "cancelled" && item.proposedAlternativeAt !== null

  // Fix L13 round 1 review PR #438 — try/catch sur format alternative date.
  let altDateLabel: string | null = null
  if (item.proposedAlternativeAt) {
    try {
      altDateLabel = new Date(item.proposedAlternativeAt).toLocaleString(locale, {
        dateStyle: "long",
        timeStyle: "short",
      })
    } catch {
      altDateLabel = new Date(item.proposedAlternativeAt).toISOString().slice(0, 16).replace("T", " ")
    }
  }

  // Fix H7 round 1 review PR #438 — badge `pending_validation` border-amber-600
  // + font-semibold pour contraste WCAG AA 4.5:1 (vs amber-500/40 → 3:1).
  const badgeClass = item.status === "pending_validation" ? "border-amber-600 font-semibold" : undefined

  return (
    <li className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{dateLabel}</span>
            {hourLabel && <span className="text-muted-foreground">· {hourLabel}</span>}
            <Badge
              variant={STATUS_BADGE_VARIANT[item.status] ?? "outline"}
              className={badgeClass}
            >
              {t(`status.${item.status}`)}
            </Badge>
          </div>
          {item.type && (
            <span className="text-sm text-muted-foreground">
              {t(`type.${item.type}`)}
              {item.durationMinutes && ` · ${item.durationMinutes} ${t("minutesShort")}`}
              {item.location && ` · ${t(`location.${item.location}`)}`}
            </span>
          )}
          {altDateLabel && (
            <span className="text-xs text-amber-700 mt-1">
              {t("myAppointmentsProposedAlt", { date: altDateLabel })}
            </span>
          )}
        </div>
        {canAcceptAlt && (
          <Button
            variant="default"
            size="sm"
            onClick={() => onAccept(item.id)}
            disabled={submitting}
            aria-busy={submitting}
            className="min-h-[44px] min-w-[44px]"
            // Fix A11y M12 round 1 review PR #438 — aria-label discriminant
            // (modal/liste avec plusieurs CTAs : "Accepter alternative pour le RDV #X").
            aria-label={t("actionAcceptAlternativeAria", { id: item.id })}
          >
            {submitting ? t("loading") : t("actionAcceptAlternative")}
          </Button>
        )}
      </div>
    </li>
  )
})
