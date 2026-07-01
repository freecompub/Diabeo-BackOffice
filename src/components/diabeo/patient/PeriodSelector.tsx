"use client"

/**
 * US-2634 — Sélecteur de période de la fiche patient (1 sem / 2 sem / 1 mois /
 * 3 mois), synchronisé entre onglets via `PatientRecordContext`.
 *
 * Pattern a11y : **`radiogroup`** (sélection unique d'un filtre), PAS `tablist`
 * — les segments ne contrôlent aucun `tabpanel` propre (ils re-paramètrent le
 * contenu des onglets existants). Navigation clavier ←/→/Home/End + roving
 * tabindex, `aria-checked` sur l'option active.
 */

import { useRef, type KeyboardEvent } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import {
  RECORD_PERIODS,
  PERIOD_LABEL_KEY,
  usePatientRecordContext,
} from "./PatientRecordContext"

export function PeriodSelector() {
  const t = useTranslations("patientDetail")
  const ctx = usePatientRecordContext()
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  // Hors provider (ex. états sans données) : pas de sélecteur.
  if (!ctx) return null
  const { period, setPeriod } = ctx

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next = index
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % RECORD_PERIODS.length
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + RECORD_PERIODS.length) % RECORD_PERIODS.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = RECORD_PERIODS.length - 1
    else return
    e.preventDefault()
    setPeriod(RECORD_PERIODS[next])
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("periodSelectorLabel")}
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
    >
      {RECORD_PERIODS.map((p, i) => {
        const active = p === period
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el
            }}
            onClick={() => setPeriod(p)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "min-h-8 rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              active
                ? "bg-card text-foreground shadow-diabeo-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(PERIOD_LABEL_KEY[p])}
          </button>
        )
      })}
    </div>
  )
}
