"use client"

/**
 * US-2018b — Drawer de consultation patient (workspace éphémère).
 *
 * Panneau latéral (extensible plein écran) ouvert par-dessus la liste. Navigation
 * interne par onglets horizontaux. `role="dialog"` + `aria-modal` ; le reste de
 * l'app est rendu `inert` par le `ConsultationProvider`, ce qui piège
 * naturellement le focus clavier dans le drawer (pas de trap manuel à maintenir).
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { useTranslations } from "next-intl"
import { Maximize2, Minimize2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ConsultationPatient } from "./ConsultationContext"
import { OverviewTab } from "./tabs/OverviewTab"
import { GlycemicProfileTab } from "./tabs/GlycemicProfileTab"
import { GlycemiaTab } from "./tabs/GlycemiaTab"
import { TreatmentTab } from "./tabs/TreatmentTab"
import { DocumentsTab } from "./tabs/DocumentsTab"

type TabKey = "overview" | "glycemicProfile" | "glycemia" | "treatment" | "documents"

const TABS: TabKey[] = ["overview", "glycemicProfile", "glycemia", "treatment", "documents"]

interface Props {
  patient: ConsultationPatient
  cTok: string
  expanded: boolean
  onClose: () => void
  onToggleExpanded: () => void
}

export function PatientConsultationDrawer({
  patient,
  cTok,
  expanded,
  onClose,
  onToggleExpanded,
}: Props) {
  const t = useTranslations("consultation")
  const [active, setActive] = useState<TabKey>("overview")
  const headingRef = useRef<HTMLHeadingElement>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Déplace le focus dans le drawer à l'ouverture (WCAG — gestion du focus).
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // Navigation clavier des onglets (pattern WAI-ARIA Tabs) : ←/→/Home/End.
  function onTabKeyDown(e: ReactKeyboardEvent, index: number) {
    let next = index
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = TABS.length - 1
    else return
    e.preventDefault()
    setActive(TABS[next])
    tabRefs.current[next]?.focus()
  }

  const ageLabel = patient.age !== null ? `${patient.age} ${t("yearsShort")}` : null
  const subtitle = [`${t(`pathology.${patient.pathology}`)}`, ageLabel].filter(Boolean).join(" · ")

  return (
    <>
      {/* Scrim — clic en dehors = fermeture ; assombrit la sidebar/le contenu. */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="consultation-title"
        className={cn(
          "fixed inset-y-0 end-0 z-50 flex flex-col border-s border-border bg-card shadow-2xl",
          "transition-[width] duration-200",
          expanded ? "w-full" : "w-full sm:w-[88%] lg:w-[76%]",
        )}
      >
        {/* Bandeau éphémère */}
        <p className="flex items-center gap-2 border-b border-[var(--color-glycemia-high)]/30 bg-[color-mix(in_srgb,var(--color-glycemia-high)_8%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--color-glycemia-high)]">
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-glycemia-high)]"
            aria-hidden="true"
          />
          {t("ephemeralNotice")}
        </p>

        {/* En-tête patient */}
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-semibold text-teal-700">
            {patient.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{t("breadcrumbRoot")}</p>
            <h2
              id="consultation-title"
              ref={headingRef}
              tabIndex={-1}
              className="truncate text-base font-semibold text-foreground outline-none"
            >
              {patient.name}
            </h2>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted"
            aria-label={expanded ? t("collapse") : t("expand")}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted"
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Onglets — roving tabindex + flèches (pattern WAI-ARIA Tabs) */}
        <div role="tablist" aria-label={t("tabsLabel")} className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-2">
          {TABS.map((key, i) => (
            <button
              key={key}
              id={`ctab-${key}`}
              role="tab"
              type="button"
              aria-selected={active === key}
              aria-controls={`cpanel-${key}`}
              tabIndex={active === key ? 0 : -1}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              onClick={() => setActive(key)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                active === key
                  ? "border-teal-600 font-semibold text-teal-600"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>

        {/* Contenu de l'onglet actif */}
        <div
          role="tabpanel"
          id={`cpanel-${active}`}
          aria-labelledby={`ctab-${active}`}
          tabIndex={0}
          className="flex-1 overflow-y-auto p-4"
        >
          {active === "overview" && <OverviewTab cTok={cTok} />}
          {active === "glycemicProfile" && <GlycemicProfileTab cTok={cTok} />}
          {active === "glycemia" && <GlycemiaTab cTok={cTok} />}
          {active === "treatment" && <TreatmentTab cTok={cTok} />}
          {active === "documents" && <DocumentsTab cTok={cTok} />}
        </div>

        {/* Annonce d'ouverture pour lecteurs d'écran (WCAG 4.1.3). */}
        <p className="sr-only" role="status" aria-live="polite">
          {t("openedAnnounce", { name: patient.name })}
        </p>
      </aside>
    </>
  )
}
