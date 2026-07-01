"use client"

/**
 * US-2636 — Sélecteur de vue de la fiche patient (Moyenne / Tableau journalier),
 * synchronisé entre onglets via `PatientRecordContext`.
 *
 * Même pattern a11y que `PeriodSelector` : **`radiogroup`** (sélection unique),
 * navigation ←/→/Home/End + roving tabindex, `aria-checked` sur l'option active.
 */

import { useRef, type KeyboardEvent } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import {
  RECORD_VIEWS,
  VIEW_LABEL_KEY,
  usePatientRecordContext,
} from "./PatientRecordContext"

export function ViewSelector({ labelledBy }: { labelledBy?: string } = {}) {
  const t = useTranslations("patientDetail")
  const ctx = usePatientRecordContext()
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  if (!ctx) return null
  const { view, setView } = ctx

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next = index
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % RECORD_VIEWS.length
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + RECORD_VIEWS.length) % RECORD_VIEWS.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = RECORD_VIEWS.length - 1
    else return
    e.preventDefault()
    setView(RECORD_VIEWS[next])
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : t("viewSelectorLabel")}
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
    >
      {RECORD_VIEWS.map((v, i) => {
        const active = v === view
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el
            }}
            onClick={() => setView(v)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "min-h-8 rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              active
                ? "bg-card text-foreground shadow-diabeo-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(VIEW_LABEL_KEY[v])}
          </button>
        )
      })}
    </div>
  )
}
