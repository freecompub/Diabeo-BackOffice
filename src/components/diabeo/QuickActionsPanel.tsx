/**
 * US-3363 — Quick Actions Panel (patient web).
 *
 * Four full-width call-to-action buttons stacked vertically. Each button
 * is a navigation/modal trigger — no API calls happen here. Callers wire
 * `onAction` to open the matching modal (glucose input, meal wizard,
 * bolus calculator, report export).
 *
 * Accessibility:
 *  - Each button is a real `<button>` with explicit `aria-label`.
 *  - Icon is decorative (`aria-hidden`) ; the visible label carries the
 *    accessible name.
 */

"use client"

import { useTranslations } from "next-intl"
import {
  Droplet, Utensils, Syringe, FileDown, type LucideIcon,
} from "lucide-react"

export type QuickAction =
  | "logGlucose"
  | "addMeal"
  | "calculateBolus"
  | "exportReport"

export interface QuickActionsPanelProps {
  onAction: (action: QuickAction) => void
}

interface ActionDef {
  id: QuickAction
  /** i18n key in the `patient.quickActions` namespace (translated at render). */
  labelKey: string
  icon: LucideIcon
}

const ACTIONS: readonly ActionDef[] = [
  { id: "logGlucose", labelKey: "logGlucose", icon: Droplet },
  { id: "addMeal", labelKey: "addMeal", icon: Utensils },
  { id: "calculateBolus", labelKey: "calculateBolus", icon: Syringe },
  { id: "exportReport", labelKey: "exportReport", icon: FileDown },
] as const

export function QuickActionsPanel({ onAction }: QuickActionsPanelProps) {
  const t = useTranslations("patient.quickActions")
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{t("title")}</h3>
      <div className="flex flex-col gap-2">
        {ACTIONS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onAction(id)}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-lg
                       bg-teal-50 hover:bg-teal-100 active:bg-teal-200
                       text-teal-900 font-medium text-sm
                       border border-teal-200
                       transition-colors
                       focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-1"
          >
            {/* C3 (re-review) — visible <span> carries the accessible name,
                aria-label removed to avoid screen-reader double-read. */}
            <Icon className="w-5 h-5 text-teal-700" aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
