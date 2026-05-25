"use client"

/**
 * MyAppointmentsList — liste chronologique des RDV du patient connecté.
 *
 * US-2500-UI iter 12 — surface web complémentaire de l'app iOS Diabeo.
 *
 * **Fetch** : `useAppointments({ patientId, memberId: undefined, ... })` —
 * range -30j → +90j (couvre prochains + récents passés). Backend RBAC
 * VIEWER → own patient uniquement (US-2200 access control).
 *
 * **UI** :
 *   - Sections "Prochains" (>= today) + "Passés" (< today)
 *   - Tri chronologique : prochains croissant, passés décroissant
 *   - Bouton "Accepter alternative" si status=cancelled + propAlt set
 *   - Badge statut couleurs Sérénité Active
 *
 * **A11y** :
 *   - Sections h2 avec landmark `<section aria-labelledby>`
 *   - aria-live="polite" sur les actions accept (succès / erreur)
 *   - Touch targets boutons ≥ 44px
 *
 * **Pattern hooks** : réutilise `useAppointments` (iter 1) +
 * `useAcceptAlternative` (iter 9 — pattern HSA-3 whitelist + mountedRef).
 */

import { useCallback, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAppointments } from "./useAppointments"
import { useAcceptAlternative } from "./useAcceptAlternative"
import { useAutoClearAfter } from "@/hooks/useAutoClearAfter"
import type { AppointmentListItem } from "./useAppointments"

export interface MyAppointmentsListProps {
  /** patient.id du VIEWER connecté (résolu par la page server-component). */
  patientId: number
}

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  scheduled: "default",
  pending_validation: "outline",
  confirmed: "default",
  cancelled: "destructive",
  completed: "secondary",
  no_show: "destructive",
}

/** Range fetch : 30j passé → 90j futur (couvre prochains + historique récent). */
function computePatientRange(): { from: Date; to: Date } {
  const from = new Date()
  from.setDate(from.getDate() - 30)
  from.setUTCHours(0, 0, 0, 0)
  const to = new Date()
  to.setDate(to.getDate() + 90)
  to.setUTCHours(23, 59, 59, 999)
  return { from, to }
}

export function MyAppointmentsList({ patientId }: MyAppointmentsListProps) {
  const t = useTranslations("appointments")
  const locale = useLocale()

  const range = useMemo(() => computePatientRange(), [])
  const { items, isInitialLoading, error, lastFetchedAt, refetch } = useAppointments({
    from: range.from,
    to: range.to,
    patientId,
  })

  // Hook accept alternative — réutilise pattern iter 9.
  const acceptAltHook = useAcceptAlternative()
  const [actionMessage, setActionMessage] = useState<{
    kind: "success" | "error"
    code: string
    apptId: number
  } | null>(null)
  const clearAction = useCallback(() => setActionMessage(null), [])
  useAutoClearAfter(actionMessage, clearAction, 4000)

  const handleAccept = useCallback(
    async (apptId: number) => {
      const result = await acceptAltHook.submit(apptId)
      if (result.ok) {
        setActionMessage({ kind: "success", code: "acceptAltSuccess", apptId })
        void refetch()
      } else {
        setActionMessage({ kind: "error", code: result.code, apptId })
      }
    },
    [acceptAltHook, refetch],
  )

  // Split chronologique : prochains (>= today) vs passés (< today)
  // calculé via useMemo([items, now]) — `now` snapshot lazy au mount
  // (Fix React-Compiler — `Date.now()` au render refusé).
  const [nowMs] = useState(() => Date.now())
  const { upcoming, past } = useMemo(() => {
    const todayMs = nowMs - 12 * 3600 * 1000 // tolérance demi-journée
    const up: AppointmentListItem[] = []
    const ps: AppointmentListItem[] = []
    for (const it of items) {
      const dt = new Date(it.date).getTime()
      if (dt >= todayMs) up.push(it)
      else ps.push(it)
    }
    // Tri : prochains croissants (proche en haut), passés décroissants (récent en haut).
    up.sort((a, b) => a.date.localeCompare(b.date))
    ps.sort((a, b) => b.date.localeCompare(a.date))
    return { upcoming: up, past: ps }
  }, [items, nowMs])

  if (isInitialLoading) {
    return (
      <div role="status" aria-busy="true" aria-live="polite" className="text-sm text-muted-foreground">
        {t("loading")}
      </div>
    )
  }
  if (error) {
    return (
      <div role="alert" className="rounded-md border border-red-500/40 bg-red-50 p-4 text-sm text-red-900">
        {t("myAppointmentsError")}
        {lastFetchedAt && (
          <span className="ml-2 text-xs text-muted-foreground">
            ({t("lastSync", { time: lastFetchedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })})
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* aria-live polite pour annonce action accept (succès/erreur) */}
      {actionMessage && (
        <div
          role={actionMessage.kind === "error" ? "alert" : "status"}
          aria-live={actionMessage.kind === "error" ? "assertive" : "polite"}
          className={
            actionMessage.kind === "success"
              ? "rounded-md border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-900"
              : "rounded-md border border-red-500/40 bg-red-50 p-3 text-sm text-red-900"
          }
        >
          {t(actionMessage.kind === "success" ? "myAppointmentsAcceptOk" : "myAppointmentsAcceptError")}
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
                loading={acceptAltHook.loading}
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
                loading={acceptAltHook.loading}
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
  loading: boolean
}

function AppointmentCard({ item, locale, onAccept, loading }: AppointmentCardProps) {
  const t = useTranslations("appointments")

  // Format wall-clock cohérent contrat US-2500-UI (timeZone: UTC, vs runtime).
  const dateLabel = useMemo(() => {
    try {
      const datePart = item.date.includes("T") ? item.date.split("T")[0] : item.date
      const [y, m, d] = datePart.split("-").map(Number)
      return new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(y, m - 1, d)))
    } catch {
      return item.date
    }
  }, [item.date, locale])

  const hourLabel = item.hour ? item.hour.slice(0, 5) : null
  const canAcceptAlt = item.status === "cancelled" && item.proposedAlternativeAt !== null

  return (
    <li className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{dateLabel}</span>
            {hourLabel && <span className="text-muted-foreground">· {hourLabel}</span>}
            <Badge variant={STATUS_BADGE_VARIANT[item.status] ?? "outline"}>
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
          {item.proposedAlternativeAt && (
            <span className="text-xs text-amber-700 mt-1">
              {t("myAppointmentsProposedAlt", {
                date: new Date(item.proposedAlternativeAt).toLocaleString(locale, {
                  dateStyle: "long",
                  timeStyle: "short",
                }),
              })}
            </span>
          )}
        </div>
        {canAcceptAlt && (
          <Button
            variant="default"
            size="sm"
            onClick={() => onAccept(item.id)}
            disabled={loading}
            className="min-h-[44px]"
          >
            {loading ? t("loading") : t("actionAcceptAlternative")}
          </Button>
        )}
      </div>
    </li>
  )
}
