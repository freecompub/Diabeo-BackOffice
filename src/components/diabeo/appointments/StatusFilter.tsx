"use client"

/**
 * StatusFilter — multi-select filtre statut RDV via chips toggle inline.
 *
 * US-2500-UI iter 8 — Affichage horizontal de 6 chips (1 par statut) que
 * l'utilisateur peut activer/désactiver. Filtre client-side appliqué via
 * `items.filter(it => value.has(it.status))` dans `<AppointmentCalendar>`.
 *
 * **Defaults** : `scheduled + pending_validation + confirmed` actifs.
 * (cf. spec US-2500-UI §Filtres et scope — exclut par défaut les statuts
 * terminaux pour ne pas polluer la vue jour).
 *
 * **A11y** : groupe `role="group"` + `aria-label` + chaque chip est un
 * `<button>` natif avec `aria-pressed` (state on/off SR-friendly) +
 * touch target 44px×44px (WCAG 2.5.5).
 *
 * **Pattern** : controlled — `value: Set<AppointmentStatus>` + `onChange`.
 * Set garantit lookup O(1) côté parent pour `items.filter`.
 */

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import type { AppointmentStatus } from "@prisma/client"
import { cn } from "@/lib/utils"

const ALL_STATUSES: ReadonlyArray<AppointmentStatus> = [
  "scheduled",
  "pending_validation",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]

/** Defaults metier — actifs à l'ouverture du calendar (RDV à venir). */
export const DEFAULT_STATUS_FILTER: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>([
  "scheduled",
  "pending_validation",
  "confirmed",
])

/** Palette chip — alignée avec `APPOINTMENT_CALENDARS` adapter.ts. */
const STATUS_CHIP_COLORS: Record<AppointmentStatus, string> = {
  scheduled: "border-teal-600 text-teal-900",
  pending_validation: "border-amber-500 text-amber-900",
  confirmed: "border-emerald-500 text-emerald-900",
  cancelled: "border-red-500 text-red-900",
  completed: "border-gray-500 text-gray-900",
  no_show: "border-red-700 text-red-900",
}

export interface StatusFilterProps {
  value: ReadonlySet<AppointmentStatus>
  onChange: (next: ReadonlySet<AppointmentStatus>) => void
}

export function StatusFilter({ value, onChange }: StatusFilterProps) {
  const t = useTranslations("appointments")

  const toggle = useCallback(
    (status: AppointmentStatus) => {
      const next = new Set(value)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      onChange(next)
    },
    [value, onChange],
  )

  return (
    <div
      role="group"
      aria-label={t("statusFilterLabel")}
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-xs font-medium text-muted-foreground">
        {t("statusFilterLabel")} :
      </span>
      {ALL_STATUSES.map((status) => {
        const active = value.has(status)
        return (
          <button
            key={status}
            type="button"
            onClick={() => toggle(status)}
            aria-pressed={active}
            className={cn(
              "text-xs px-3 min-h-[44px] rounded-full border transition-all",
              STATUS_CHIP_COLORS[status],
              active
                ? "bg-foreground/5 font-medium"
                : "opacity-50 hover:opacity-80",
            )}
          >
            {t(`status.${status}`)}
          </button>
        )
      })}
    </div>
  )
}
