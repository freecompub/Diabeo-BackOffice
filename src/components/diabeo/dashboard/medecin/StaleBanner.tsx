/**
 * Shared stale-data banner for dashboard cards.
 *
 * code-review M3 (re-review) — the orange `text-glycemia-high` tint alone
 * is too close to muted text to register as a visual signal at a glance.
 * Adding a clock icon + bold weight makes the obsolete state legible
 * without screen-reader announcement (WCAG 1.4.1 use-of-color : passes
 * even at the cost of icon support).
 *
 * i18n (US-2112c review) — `message` is REQUIRED and must be a localized
 * string (callers pass `t("dashboard.medecin.stale")`). No default is provided
 * on purpose : a hardcoded fallback would silently re-introduce a single-locale
 * leak (the exact i18n-1 bug class), with no type-level signal to the caller.
 */

"use client"

import { Clock } from "lucide-react"

/**
 * Legacy French fallback for dashboards not yet internationalized
 * (infirmier / admin cards — follow-up US-2112d). Those call sites pass this
 * constant EXPLICITLY so the residual FR leak stays greppable and is replaced
 * by `t("…stale")` when those dashboards get i18n'd. The /medecin cards
 * (US-2112c) already pass a localized `t("dashboard.medecin.stale")`.
 */
export const STALE_MESSAGE_FR = "Données obsolètes — rafraîchissement en attente."

export function StaleBanner({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-1.5 px-4 text-xs font-medium text-glycemia-high"
    >
      <Clock size={12} aria-hidden="true" />
      <span>{message}</span>
    </p>
  )
}
