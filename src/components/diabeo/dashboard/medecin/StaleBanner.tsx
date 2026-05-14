/**
 * Shared stale-data banner for dashboard cards.
 *
 * code-review M3 (re-review) — the orange `text-glycemia-high` tint alone
 * is too close to muted text to register as a visual signal at a glance.
 * Adding a clock icon + bold weight makes the obsolete state legible
 * without screen-reader announcement (WCAG 1.4.1 use-of-color : passes
 * even at the cost of icon support).
 */

"use client"

import { Clock } from "lucide-react"

export function StaleBanner({ message = "Données obsolètes — rafraîchissement en attente." }: {
  message?: string
}) {
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
