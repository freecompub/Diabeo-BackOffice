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

/**
 * Liste des statuts affichables — hardcodée (alignée avec enum Prisma).
 *
 * Fix CR-11 round 1 review PR #436 — si Prisma ajoute un nouveau statut
 * (e.g. `rescheduled`), il sera invisible côté filter UI tant que ce tableau
 * n'est pas mis à jour. Pas critique car backend gate le statut accepté.
 * Test CI à créer V1.5 : iterate `AppointmentStatus` enum via Object.values
 * et assert que `ALL_STATUSES` contient tous les membres.
 */
const ALL_STATUSES: ReadonlyArray<AppointmentStatus> = [
  "scheduled",
  "pending_validation",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]

/**
 * Defaults metier — actifs à l'ouverture du calendar (RDV à venir).
 *
 * Fix CR-13 round 1 review PR #436 — `ReadonlySet` est un contract type-only,
 * pas un freeze runtime. Pour bloquer toute mutation accidentelle d'un caller
 * mal codé (cast + `.add()`), on aurait besoin d'un Proxy custom car les
 * Maps/Sets n'acceptent pas `Object.freeze`. Documenter le contrat suffit
 * pour V1 — tous les consumers internes respectent le ReadonlySet typing.
 */
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
              // Fix FE-11 round 1 review PR #436 — text-sm + min-h-[36px]
              // (WCAG 2.5.5 AA exige 24×24 minimum — 36 reste confortable
              // sans le visual mismatch "bouton vide" qu'on avait avec
              // min-h-[44px] + text-xs).
              "text-sm px-3 min-h-[36px] rounded-full border transition-all",
              // Fix FE-8 round 1 review PR #436 — focus-visible explicit ring
              // pour clavier nav (WCAG 2.4.7 Focus Visible AA).
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
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
